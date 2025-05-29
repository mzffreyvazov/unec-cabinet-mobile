// backend/services/unecClient.js
import axios from 'axios';
import { wrapper as axiosCookieJarSupport } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

axiosCookieJarSupport(axios); // Apply cookie jar support to the imported axios instance
puppeteer.use(StealthPlugin());

const BASE_URL = 'https://kabinet.unec.edu.az';
const AZ_BASE_PATH = '/az/'; // Used for login page and login POST target
const STUDENT_EVAL_PATH = `${AZ_BASE_PATH}studentEvaluation`; // Used as referer
const GET_EDU_SEMESTER_PATH = `${AZ_BASE_PATH}getEduSemester`;
const STUDENT_EVAL_POPUP_PATH = `${AZ_BASE_PATH}studentEvaluationPopup`;


const defaultGetHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 UNECDataWebApp/1.0',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en-GB;q=0.9,en;q=0.8',
    'DNT': '1', // From your cURL examples
    'Sec-CH-UA': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
    'Upgrade-Insecure-Requests': '1'
};

const defaultPostHeaders = {
    ...defaultGetHeaders, // Inherit GET headers
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Origin': BASE_URL,
    'Sec-Fetch-Site': 'same-origin', // Common for POSTs initiated by user action on site
    // 'X-Requested-With': 'XMLHttpRequest' // Add this if a specific POST is an AJAX call
};


// Internal Parser Functions (prefixed with _ to indicate primary internal use)
function _extractCsrfTokenFromHtml(html) {
    if (!html) { console.warn('UNEC_CLIENT (Parser): HTML for CSRF extraction is empty.'); return null; }
    const $ = cheerio.load(html);
    let token = $('input[name="csrf_token"]').val() ||
                $('input[name="YII_CSRF_TOKEN"]').val() ||
                $('input[name="_csrf"]').val() ||
                $('meta[name="csrf-token"]').attr('content');
    console.log('UNEC_CLIENT (Parser): Extracted CSRF (if any):', token);
    return token || null;
}

function _extractYears(html) {
    if (!html) { console.warn('UNEC_CLIENT (Parser): HTML for year extraction is empty.'); return []; }
    const $ = cheerio.load(html); const years = [];
    $('#eduYear option').each((i, el) => {
        const value = $(el).val();
        const text = $(el).text().trim();
        if (value && value.trim() !== "") {
            years.push({ value, text });
        }
    });
    years.sort((a, b) => (parseInt(b.text.split(' - ')[0]) - parseInt(a.text.split(' - ')[0])));
    console.log('UNEC_CLIENT (Parser): Extracted years count:', years.length); return years;
}

function _extractSemestersFromOptionsHtml(html) {
    if (!html) { console.warn('UNEC_CLIENT (Parser): HTML for semester options extraction is empty.'); return []; }
    const $ = cheerio.load(`<select>${html}</select>`); const semesters = []; // Wrap to parse options
    $('option').each((i, el) => {
        const value = $(el).val();
        const text = $(el).text().trim();
        if (value && value.trim() !== "") {
            semesters.push({ value, text });
        }
    });
    console.log('UNEC_CLIENT (Parser): Extracted semesters from options HTML count:', semesters.length); return semesters;
}

function _extractSubjects(html) {
    if (!html) { console.warn('UNEC_CLIENT (Parser): HTML for subject extraction is empty.'); return []; }
    const $ = cheerio.load(html); const subjects = [];
    $('#studentEvaluation-grid tbody tr:not(.empty)').each((i, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 6) { // cells[5] is edu_form_id
            const id = $(cells[1]).text().trim();
            const name = $(cells[2]).text().trim();
            const eduFormId = $(cells[5]).text().trim();
            if (id && name && eduFormId) subjects.push({ id, name, edu_form_id: eduFormId });
        }
    });
    console.log('UNEC_CLIENT (Parser): Extracted subjects count:', subjects.length); return subjects;
}

function _extractFinalEvalDataFromModalHtml(modalHtml) {
    if (!modalHtml) { console.warn('UNEC_CLIENT (Parser): Modal HTML for final eval data is empty.'); return { qaibFaizi: null }; }
    const $ = cheerio.load(modalHtml); let qaibFaizi = null;
    const finalEvalDiv = $('#finalEval.tab-pane');
    if (finalEvalDiv.length) {
        const cells = finalEvalDiv.find('table tbody tr').first().find('td');
        if (cells.length > 14) { // "Qaib faizi" is 15th cell (index 14)
            qaibFaizi = $(cells[14]).text().trim();
        } else console.warn("UNEC_CLIENT (Parser): Not enough cells in finalEval row for Qaib Faizi. Found:", cells.length);
    } else console.warn("UNEC_CLIENT (Parser): #finalEval div not found in modal HTML.");
    console.log('UNEC_CLIENT (Parser): Extracted Qaib Faizi:', qaibFaizi); return { qaibFaizi };
}

const unecClient = {
    BASE_URL: BASE_URL, // For use in routes if needed

    getLoginPageAndCsrf: async () => {
        const jar = new CookieJar();
        const targetUrl = BASE_URL + AZ_BASE_PATH;
        console.log('UNEC_CLIENT: Fetching login page to get CSRF and cookies from:', targetUrl);
        try {
            const response = await axios.get(targetUrl, {
                jar: jar,
                withCredentials: true,
                headers: defaultGetHeaders
            });
            const csrfToken = _extractCsrfTokenFromHtml(response.data);
            if (!csrfToken) {
                console.error('UNEC_CLIENT: CSRF token not found on login page. HTML (first 500 chars):', response.data ? response.data.substring(0,500) : "HTML is null/undefined");
                throw new Error('CSRF token not found on login page.');
            }
            console.log('UNEC_CLIENT: CSRF Token found:', csrfToken);
            // const cookies = await jar.getCookies(targetUrl); // Get cookies for the specific URL
            // console.log('UNEC_CLIENT: Initial cookies from login page:', cookies.map(c=>c.cookieString()).join('; '));
            return { csrfToken, cookieJar: jar };
        } catch (error) {
            console.error(`UNEC_CLIENT: Error in getLoginPageAndCsrf: ${error.message}`, error.isAxiosError && error.config ? {url: error.config.url, method: error.config.method } : '');
            throw error; // Re-throw to be caught by the route handler
        }
    },

    submitLogin: async (username, password) => {
            console.log(`UNEC_CLIENT (Puppeteer-Stealth): Launching browser for login: ${username}`);
            let browser = null;
            let page = null;
            const timestamp = Date.now();

            try {
                browser = await puppeteer.launch({
                    headless: false, // Keep headful for now to observe
                    slowMo: 100,
                    devtools: true,
                    args: ['--disable-infobars', '--window-size=1366,768']
                });
                page = await browser.newPage();
                await page.setViewport({ width: 1366, height: 768 });
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36');

                // Intercept requests to block the RUM beacon
                await page.setRequestInterception(true);
                page.on('request', (request) => {
                    const url = request.url();
                    if (url.includes('/cdn-cgi/rum?')) {
                        console.log('UNEC_CLIENT (Puppeteer): Blocking RUM beacon request to:', url);
                        request.abort().catch(e => console.warn("Failed to abort RUM request, might be too late:", e.message));
                    } else {
                        request.continue().catch(e => console.warn("Failed to continue non-RUM request:", e.message));
                    }
                });

                // Optional: Log page console messages
                page.on('console', msg => console.log(`PUPPETEER_PAGE_CONSOLE (${msg.type()}): ${msg.text()}`));
                page.on('pageerror', ({ message }) => console.log(`PUPPETEER_PAGE_ERROR: ${message}`));


                console.log('UNEC_CLIENT (Puppeteer): Navigating to login page:', BASE_URL + AZ_BASE_PATH);
                await page.goto(BASE_URL + AZ_BASE_PATH, { waitUntil: 'networkidle0', timeout: 30000 });
                console.log('UNEC_CLIENT (Puppeteer): Login page loaded. URL:', page.url());
                await page.screenshot({ path: `puppeteer_0_loginpage_${timestamp}.png` });

                console.log('UNEC_CLIENT (Puppeteer): Filling login form...');
                await page.waitForSelector('input[name="LoginForm[username]"]', { timeout: 10000 });
                await page.type('input[name="LoginForm[username]"]', username, { delay: 100 });
                await page.type('input[name="LoginForm[password]"]', password, { delay: 100 });
                await page.screenshot({ path: `puppeteer_1_formfilled_${timestamp}.png` });

                console.log('UNEC_CLIENT (Puppeteer): Submitting login form by clicking submit button...');
                await page.click('input[type="submit"][name="yt0"]');
                console.log('UNEC_CLIENT (Puppeteer): Submit button clicked. Waiting for navigation (or page reaction)...');
                
                // Try waiting for a selector that would ONLY appear on a successful login page (dashboard)
                // OR for the URL to change to the dashboard.
                // If neither happens and it stays on the login page, or a specific error selector appears, then it failed.
                let loginSuccess = false;
                try {
                    // Wait for either a known dashboard URL or a selector on the dashboard
                    // Example: wait for noteandannounce in URL or a specific element like '#sidebar' if it's unique to logged-in state
                    console.log("UNEC_CLIENT (Puppeteer): Waiting for successful navigation indicator...");
                    await page.waitForFunction(
                        () => window.location.href.includes('/az/noteandannounce') || window.location.href.includes('/az/index') || document.querySelector('#sidebar'), // Adjust selector if needed
                        { timeout: 20000 } // 20 second timeout for this
                    );
                    loginSuccess = true;
                    console.log('UNEC_CLIENT (Puppeteer): Detected navigation to a dashboard page.');
                } catch (e) {
                    // This timeout means it didn't navigate to a success page or find the success selector
                    console.warn('UNEC_CLIENT (Puppeteer): Did not navigate to a known dashboard page or find success element. Login likely failed. Error during wait:', e.message.split('\n')[0]);
                    loginSuccess = false;
                }


                const finalUrl = page.url();
                console.log('UNEC_CLIENT (Puppeteer): Final URL after login attempt:', finalUrl);
                await page.screenshot({ path: `puppeteer_2_aftersubmit_attempt_${timestamp}.png`});

                if (loginSuccess && (finalUrl.includes('/az/noteandannounce') || finalUrl.includes('/az/index'))) {
                    console.log('UNEC_CLIENT (Puppeteer): Login successful!');
                    // ... (cookie extraction logic as before) ...
                    const browserCookies = await page.cookies(BASE_URL);
                    const cookieJar = new CookieJar();
                    for (const cookie of browserCookies) {
                        const cookieString = `${cookie.name}=${cookie.value}`;
                        try { await cookieJar.setCookie(cookieString, `https://${cookie.domain}${cookie.path}`);}
                        catch (cookieSetError) { console.warn("Error setting cookie in jar:", cookieSetError.message, cookieString); }
                    }
                    return { success: true, authenticatedCookieJar: cookieJar, message: "Login successful via Puppeteer (RUM blocked)." };
                } else {
                    const pageContent = await page.content();
                    console.log(`UNEC_CLIENT (Puppeteer): Login failed. Landed on: ${finalUrl}.`);
                    const $ = cheerio.load(pageContent);
                    const loginError = $('.alert-danger').text()?.trim() || $('.errorSummary ul li').first().text()?.trim();
                    const message = loginError || `Login via Puppeteer failed. Landed on: ${finalUrl}`;
                    console.warn('UNEC_CLIENT (Puppeteer): Login failed diagnosis:', message);
                    return { success: false, authenticatedCookieJar: null, message: message };
                }
            } catch (error) {
                console.error('UNEC_CLIENT (Puppeteer): Error during login:', error.message, error.stack ? error.stack.split('\n').slice(0,3) : '');
                if(page) await page.screenshot({ path: `puppeteer_4_error_state_${timestamp}.png` }).catch(e => console.error("Screenshot on error failed:", e));
                return { success: false, authenticatedCookieJar: null, message: `Puppeteer login error: ${error.message}` };
            } finally {
                const DEBUG_MODE_PUPPETEER = true; // Keep true for now
                if (browser && browser.isConnected()) {
                    if (DEBUG_MODE_PUPPETEER) {
                        console.log("UNEC_CLIENT (Puppeteer): DEBUG MODE - Browser will stay open for inspection. Close manually or wait for timeout.");
                        await new Promise(resolve => setTimeout(resolve, 60000)); // 1 minute
                        if (browser.isConnected()) await browser.close().catch(e => console.error("Error closing browser in finally:",e));
                    } else { /* ... */ }
                } else { /* ... */ }
            }
    },

    fetchAuthedPage: async (urlPath, cookieJar) => {
        const fullUrl = urlPath.startsWith('http') ? urlPath : BASE_URL + urlPath;
        console.log(`UNEC_CLIENT: Fetching authed page: GET ${fullUrl}`);
        try {
            const response = await axios.get(fullUrl, { jar: cookieJar, withCredentials: true, headers: defaultGetHeaders });
            return response.data;
        } catch (error) { console.error(`UNEC_CLIENT: Error fetching ${fullUrl}: ${error.message}`); throw error; }
    },

    getSemesters: async (yearId, cookieJar, csrfToken) => {
        const url = BASE_URL + GET_EDU_SEMESTER_PATH;
        console.log(`UNEC_CLIENT: Fetching semesters via POST for yearId ${yearId} from ${url}`);
        const formData = new URLSearchParams();
        formData.append('type', 'eduYear'); formData.append('id', yearId);
        // CSRF for /getEduSemester POST: Your cURL for this didn't show a CSRF in form data.
        // It might rely on the session cookie or a CSRF header if it's an AJAX-like call.
        // For now, assuming no explicit CSRF in form body is needed based on your previous finding.
        // If this POST fails, CSRF (in headers or different name) is a suspect.
        const headersForSemesterPost = {...defaultPostHeaders, Referer: BASE_URL + STUDENT_EVAL_PATH, 'X-Requested-With': 'XMLHttpRequest'};
        // if (csrfToken) headersForSemesterPost['X-CSRF-TOKEN'] = csrfToken; // Example if it's a header

        try {
            const response = await axios.post(url, formData.toString(), { jar: cookieJar, withCredentials: true, headers: headersForSemesterPost });
            if (!response.data) throw new Error("Empty response from getEduSemester POST.");
            console.log("UNEC_CLIENT: Raw HTML from getEduSemester POST (first 300):", response.data.substring(0,300));
            return _extractSemestersFromOptionsHtml(response.data);
        } catch (error) { console.error(`UNEC_CLIENT: Error in getSemesters for year ${yearId}: ${error.message}`); throw error; }
    },

    getSubjectModalData: async (subjectId, eduFormId, cookieJar, csrfToken) => {
        const url = BASE_URL + STUDENT_EVAL_POPUP_PATH;
        console.log(`UNEC_CLIENT: Fetching modal data for subject ${subjectId}, eduFormId ${eduFormId} from ${url}`);
        const formData = new URLSearchParams();
        formData.append('id', subjectId); formData.append('lessonType', ''); formData.append('edu_form_id', eduFormId);

        const headersForModalPost = {...defaultPostHeaders, Referer: BASE_URL + STUDENT_EVAL_PATH, 'X-Requested-With': 'XMLHttpRequest' };
        // This POST for modal data *did* have a CSRF in your extension's trace (`YII_CSRF_TOKEN`).
        // It's usually obtained from the page displaying the subjects.
        if (csrfToken) {
             formData.append('YII_CSRF_TOKEN', csrfToken); // Assuming this is the name based on typical Yii.
             console.log("UNEC_CLIENT: Using CSRF for modal POST:", csrfToken);
        } else {
            console.warn("UNEC_CLIENT: No CSRF provided for modal POST. It will likely fail if required.");
        }
        try {
            const response = await axios.post(url, formData.toString(), { jar: cookieJar, withCredentials: true, headers: headersForModalPost });
            if (!response.data) throw new Error(`Empty modal HTML for subject ${subjectId}`);
            return _extractFinalEvalDataFromModalHtml(response.data);
        } catch (error) { console.error(`UNEC_CLIENT: Error in getSubjectModalData for subject ${subjectId}: ${error.message}`); throw error; }
    },

    // Exposing parser functions.
    parsers: {
        extractYears: _extractYears,
        extractSubjects: _extractSubjects,
        extractCsrfToken: _extractCsrfTokenFromHtml,
        extractSemestersFromOptions: _extractSemestersFromOptionsHtml,
        extractFinalEvalData: _extractFinalEvalDataFromModalHtml
    }
};

export default unecClient;