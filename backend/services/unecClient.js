// backend/services/unecClient.js
import axios from 'axios';
import { wrapper as axiosCookieJarSupport } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio'; // For parsing HTML to get CSRF

axiosCookieJarSupport(axios); // Apply cookie jar support to axios

const BASE_URL = 'https://kabinet.unec.edu.az';
const AZ_LOGIN_PATH = '/az/login'; // Assuming login form is at /az/ or /az/login
const AZ_BASE_PATH = '/az/';

const unecClient = {
    // Method to get the login page and extract CSRF token and initial cookies
    getLoginPageAndCsrf: async () => {
        const jar = new CookieJar();
        console.log('UNEC_CLIENT: Fetching login page to get CSRF and cookies...');
        try {
            const response = await axios.get(BASE_URL + AZ_BASE_PATH, { // Or specific login page if different
                jar: jar, // Use cookie jar
                withCredentials: true, // Important for server-side cookie handling with axios
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36 UNECDataWebApp/1.0',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                }
            });

            const html = response.data;
            const $ = cheerio.load(html);
            
            // Try to find CSRF token - adjust selector based on actual HTML structure
            // Common Yii names: _csrf, YII_CSRF_TOKEN, csrf_token
            let csrfToken = $('input[name="csrf_token"]').val();
            if (!csrfToken) {
                csrfToken = $('input[name="YII_CSRF_TOKEN"]').val();
            }
            if (!csrfToken) {
                csrfToken = $('input[name="_csrf"]').val();
            }
            // If it's in a meta tag:
            // if (!csrfToken) {
            //    csrfToken = $('meta[name="csrf-token"]').attr('content');
            // }


            if (!csrfToken) {
                console.error('UNEC_CLIENT: CSRF token not found on login page.');
                // console.log('UNEC_CLIENT: Login page HTML (first 1000 chars):', html.substring(0,1000));
                throw new Error('CSRF token not found on login page.');
            }
            console.log('UNEC_CLIENT: CSRF Token found:', csrfToken);
            
            const cookies = await jar.getCookies(BASE_URL);
            console.log('UNEC_CLIENT: Initial cookies from login page:', cookies.map(c => c.cookieString()).join('; '));

            return {
                csrfToken,
                cookieJar: jar // Return the cookie jar for the next request
            };
        } catch (error) {
            console.error('UNEC_CLIENT: Error fetching login page or CSRF:', error.response ? error.response.status : error.message);
            throw new Error('Failed to fetch login page details from UNEC.');
        }
    },

    // Method to submit login credentials
    submitLogin: async (username, password, csrfToken, cookieJar) => {
        const loginUrl = BASE_URL + AZ_BASE_PATH; // Login form posts to base URL or /az/
        console.log(`UNEC_CLIENT: Submitting login for ${username} to ${loginUrl}`);

        const formData = new URLSearchParams();
        formData.append('csrf_token', csrfToken); // Use the specific name from your cURL
        formData.append('LoginForm[username]', username);
        formData.append('LoginForm[password]', password);
        formData.append('yt0', 'Daxil ol'); // Submit button value

        try {
            const response = await axios.post(loginUrl, formData.toString(), {
                jar: cookieJar, // Use the same cookie jar
                withCredentials: true,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36 UNECDataWebApp/1.0',
                    'Referer': BASE_URL + AZ_BASE_PATH,
                    'Origin': BASE_URL,
                    // Add other headers from your cURL if they seem necessary, but start minimal
                },
                maxRedirects: 0, // We want to capture cookies from the redirect response
                validateStatus: function (status) {
                    return status >= 200 && status < 400; // Accept 2xx and 3xx statuses
                },
            });

            const newCookies = await cookieJar.getCookies(BASE_URL);
            const newCookieString = newCookies.map(c => c.cookieString()).join('; ');
            console.log('UNEC_CLIENT: Cookies after login attempt:', newCookieString);

            // Check for successful login:
            // 1. Status code (often 302 redirect on success)
            // 2. Location header (redirecting to /az/noteandannounce or /az/index)
            // 3. PHPSESSID cookie should have changed or been reaffirmed
            // 4. The response body if it's not a redirect (might indicate error)

            if (response.status === 302 || response.status === 200) { // 200 if it lands directly, 302 if redirect
                const locationHeader = response.headers.location || response.headers.Location;
                console.log('UNEC_CLIENT: Login response status:', response.status, "Location:", locationHeader);

                // A more robust check is needed here based on actual UNEC behavior
                // For now, if we get a 302 to a path like /az/noteandannounce or /az/index, assume success
                // Or if the PHPSESSID has changed significantly.
                // Or if the final page after redirects contains user-specific info.
                // The crucial part is that `cookieJar` is now updated with authenticated session cookies.

                if (locationHeader && (locationHeader.includes('/az/noteandannounce') || locationHeader.includes('/az/index'))) {
                     console.log('UNEC_CLIENT: Login likely successful (redirecting to dashboard).');
                    return { success: true, authenticatedCookieJar: cookieJar };
                } else if (response.status === 200 && response.request.path.includes('/az/noteandannounce')) {
                    // Sometimes after POST, it might render the target page directly with 200 OK
                    console.log('UNEC_CLIENT: Login likely successful (landed on dashboard with 200 OK).');
                    return { success: true, authenticatedCookieJar: cookieJar };
                } else if (newCookieString.includes('PHPSESSID')) { // Check if PHPSESSID is present
                    // This is a weaker check, but better than nothing if redirects are complex
                    console.log('UNEC_CLIENT: PHPSESSID found in cookies after login. Assuming success for now.');
                    return { success: true, authenticatedCookieJar: cookieJar };
                } else {
                    // If it's 200 but not the dashboard, it might be the login page again with an error
                    const html = response.data;
                    const $ = cheerio.load(html);
                    const loginError = $('.alert-danger').text() || $('.errorSummary').text(); // Common Yii error selectors
                    if (loginError) {
                        console.warn('UNEC_CLIENT: Login failed, error message on page:', loginError);
                        throw new Error(loginError || 'Login failed, unknown error on page.');
                    }
                    console.warn('UNEC_CLIENT: Login response status was OK, but not a clear success redirect or dashboard.', response.status, locationHeader);
                    throw new Error('Login response indicates potential failure.');
                }
            } else {
                console.error('UNEC_CLIENT: Login failed, unexpected status:', response.status);
                const errorText = typeof response.data === 'string' ? response.data.substring(0, 500) : JSON.stringify(response.data);
                throw new Error(`Login failed with status ${response.status}. Response: ${errorText}`);
            }

        } catch (error) {
            console.error('UNEC_CLIENT: Error submitting login:', error.message);
            if (error.response) {
                 console.error('UNEC_CLIENT: Login submission error response status:', error.response.status);
                 console.error('UNEC_CLIENT: Login submission error response data (partial):', typeof error.response.data === 'string' ? error.response.data.substring(0,500) : error.response.data);
            }
            throw new Error(error.message || 'Failed to submit login credentials to UNEC.');
        }
    },

    // ... (Placeholder for future methods like fetchAcademicData, fetchSubjectModal etc.)
    // These methods will take the `authenticatedCookieJar` as an argument
    // Example:
    // fetchDashboardHtml: async (cookieJar) => {
    //    const response = await axios.get(BASE_URL + '/az/noteandannounce', { jar: cookieJar, withCredentials: true });
    //    return response.data;
    // }
};

export default unecClient;