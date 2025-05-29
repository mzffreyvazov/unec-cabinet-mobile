// backend/services/unecClient.js
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios'; // Add this import
import { CookieJar } from 'tough-cookie'; // For managing cookies for subsequent axios calls
import * as cheerio from 'cheerio';     // For parsing HTML if needed outside Puppeteer DOM

puppeteer.use(StealthPlugin());

const BASE_URL = 'https://kabinet.unec.edu.az';
const AZ_BASE_PATH = '/az/';
const STUDENT_EVAL_PATH = `${AZ_BASE_PATH}studentEvaluation`;
const GET_EDU_SEMESTER_PATH = `${AZ_BASE_PATH}getEduSemester`;
const STUDENT_EVAL_POPUP_PATH = `${AZ_BASE_PATH}studentEvaluationPopup`;

const defaultGetHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36 UNECDataWebApp/1.0',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'DNT': '1',
    'Sec-CH-UA': '"Chromium";v="100", "Google Chrome";v="100", "Not.A/Brand";v="99"', // Adjusted to match UA
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
    'Upgrade-Insecure-Requests': '1'
};

const defaultPostHeaders = {
    ...defaultGetHeaders,
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Origin': BASE_URL,
    'Sec-Fetch-Site': 'same-origin',
    // 'X-Requested-With': 'XMLHttpRequest' // Add this specifically for AJAX-like POSTs, not main login
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
        if (value && value.trim() !== "") years.push({ value, text });
    });
    years.sort((a, b) => (parseInt(b.text.split(' - ')[0]) - parseInt(a.text.split(' - ')[0])));
    console.log('UNEC_CLIENT (Parser): Extracted years count:', years.length); return years;
}

function _extractSemestersFromOptionsHtml(html) {
    if (!html) { console.warn('UNEC_CLIENT (Parser): HTML for semester options extraction is empty.'); return []; }
    const $ = cheerio.load(`<select>${html}</select>`); const semesters = [];
    $('option').each((i, el) => {
        const value = $(el).val();
        const text = $(el).text().trim();
        if (value && value.trim() !== "") semesters.push({ value, text });
    });
    console.log('UNEC_CLIENT (Parser): Extracted semesters from options HTML count:', semesters.length); return semesters;
}

function _extractSubjects(html) {
    if (!html) { console.warn('UNEC_CLIENT (Parser): HTML for subject extraction is empty.'); return []; }
    const $ = cheerio.load(html); const subjects = [];
    $('#studentEvaluation-grid tbody tr:not(.empty)').each((i, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 6) {
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
        if (cells.length > 14) qaibFaizi = $(cells[14]).text().trim();
        else console.warn("UNEC_CLIENT (Parser): Not enough cells in finalEval row for Qaib Faizi. Found:", cells.length);
    } else console.warn("UNEC_CLIENT (Parser): #finalEval div not found in modal HTML.");
    console.log('UNEC_CLIENT (Parser): Extracted Qaib Faizi:', qaibFaizi); return { qaibFaizi };
}
// Add this new parser function to the internal parsers section
function _extractEvaluationLinkHref(html) {
    if (!html) { 
        console.warn('UNEC_CLIENT (Parser): HTML for evaluation link extraction is empty.'); 
        return null; 
    }
    const $ = cheerio.load(html);
    
    // Try multiple selectors to find the evaluation link (borrowed from extension logic)
    const selectors = [
        '.sidebar-menu a[href*="/studentEvaluation"]',
        'a[href*="/studentEvaluation"]',
        '.sidebar a[href*="/studentEvaluation"]',
        '.menu a[href*="/studentEvaluation"]',
        'a[href*="studentEvaluation"]'
    ];
    
    let evalLink = null;
    let usedSelector = '';
    
    for (const selector of selectors) {
        evalLink = $(selector);
        if (evalLink.length > 0) {
            usedSelector = selector;
            console.log(`UNEC_CLIENT (Parser): Found evaluation link using selector: ${selector}`);
            break;
        }
    }
    
    if (!evalLink || evalLink.length === 0) {
        // Log the page structure for debugging
        console.log('UNEC_CLIENT (Parser): Available links on page:');
        $('a[href*="student"]').each((i, el) => {
            console.log(`  - ${$(el).attr('href')} : ${$(el).text().trim()}`);
        });
        
        throw new Error('UNEC_CLIENT (Parser): Could not find student evaluation link in any expected location. Check the page HTML structure.');
    }
    
    const href = evalLink.first().attr('href');
    if (!href || typeof href !== 'string') {
        throw new Error('UNEC_CLIENT (Parser): Invalid href for evaluation link.');
    }
    
    console.log('UNEC_CLIENT (Parser): Found evaluation link href:', href);
    return href;
}
const unecClient = {
    BASE_URL: BASE_URL,

    submitLogin: async (username, password) => {
        console.log(`UNEC_CLIENT (Puppeteer-Stealth+Warmup): Launching browser for: ${username}`);
        let browser = null; let page = null; const ts = Date.now();

        try {
            browser = await puppeteer.launch({
                headless: true, // Keep headful for debugging this stage
                slowMo: 0,     // Slow down operations
                devtools: false,  // Open DevTools in Puppeteer's browser
                args: [
                    '--disable-infobars',
                    '--window-size=1400,900', // A common desktop size
                    // '--no-sandbox', // Uncomment if running in certain Linux environments
                    // '--disable-setuid-sandbox'
                ]
            });
            page = await browser.newPage();
            await page.setViewport({ width: 1366, height: 768 }); // Ensure viewport
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36');

            // --- Page Event Listeners for Debugging ---
            page.on('console', msg => {
                const type = msg.type().toUpperCase();
                // Filter out less critical console messages if too noisy
                if (['LOG', 'WARNING', 'ERROR', 'ASSERT', 'DEBUG'].includes(type) || type.startsWith('PUPPETEER')) {
                    console.log(`PUPPETEER_PAGE_CONSOLE [${type}]: ${msg.text()}`);
                }
            });
            page.on('pageerror', ({ message }) => console.error(`PUPPETEER_PAGE_ERROR: ${message}`));
            page.on('response', async (res) => { // Log all responses
                const req = res.request();
                // Limit URL length for brevity
                const urlShort = res.url().length > 100 ? res.url().substring(0, 97) + "..." : res.url();
                console.log(`PUPPETEER_NET: ${req.method()} ${res.status()} ${urlShort}`);
            });
            // page.on('requestfailed', req => console.warn(`PUPPETEER_REQUEST_FAILED: ${req.method()} ${req.url().substring(0,100)} - ${req.failure()?.errorText}`));


            // --- WARM-UP (Optional, but can help) ---
            console.log("PUPPETEER: WARM-UP - Navigating to main UNEC site (or cabinet base)");
            await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 0 });
            // await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
            await page.screenshot({ path: `puppeteer_warmup_0_mainpage_${ts}.png` });
            console.log("PUPPETEER: WARM-UP - Current URL after warmup:", page.url());


            console.log('PUPPETEER: Navigating to login page specifically:', BASE_URL + AZ_BASE_PATH);
            await page.goto(BASE_URL + AZ_BASE_PATH, { waitUntil: 'networkidle0', timeout: 0 });
            console.log('PUPPETEER: Login page loaded. URL:', page.url());
            console.log('PUPPETEER: Pausing 7s for initial scripts/RUM beacons...');
            // await new Promise(resolve => setTimeout(resolve, 7000)); // Pause to let RUM, etc., fire
            await page.screenshot({ path: `puppeteer_login_0_loginpage_after_wait_${ts}.png` });


            console.log('PUPPETEER: Filling form...');
            await page.waitForSelector('input[name="LoginForm[username]"]', { timeout: 0 });
            const csrfOnLoad = await page.$eval('input[name="csrf_token"]', el => el.value).catch(() => null);
            console.log("PUPPETEER: CSRF token on page load:", csrfOnLoad);

            await page.type('input[name="LoginForm[username]"]', username, { delay: 0 + Math.random() * 0 });
            await page.type('input[name="LoginForm[password]"]', password, { delay: 0 + Math.random() * 0 });

            const csrfBeforeClick = await page.$eval('input[name="csrf_token"]', el => el.value).catch(() => null);
            console.log("PUPPETEER: CSRF token value from DOM just before click:", csrfBeforeClick);
            await page.screenshot({ path: `puppeteer_login_1_formfilled_${ts}.png` });


            console.log('PUPPETEER: Submitting login form...');
            await page.click('input[type="submit"][name="yt0"]');
            console.log('PUPPETEER: Click initiated. Waiting for navigation/reaction...');

            let loginSuccess = false;
            let finalUrl = page.url(); // Initial URL before potential navigation

            try {
                await page.waitForFunction(
                    (initialUrl) => {
                        // Check if URL changed AND if it's a dashboard URL OR if a dashboard element exists
                        const currentUrl = window.location.href;
                        const dashboardElementExists = !!document.querySelector('#sidebar'); // Example dashboard element
                        const isDashboardUrl = currentUrl.includes('/az/noteandannounce') || currentUrl.includes('/az/index');
                        return (currentUrl !== initialUrl && isDashboardUrl) || dashboardElementExists;
                    },
                    { timeout: 0 }, // 25 seconds
                    finalUrl // Pass initial URL to the function
                );
                finalUrl = page.url(); // Update finalUrl after successful wait
                loginSuccess = true;
                console.log('PUPPETEER: Detected successful navigation to dashboard or dashboard element.');
            } catch (e) {
                finalUrl = page.url(); // Get URL even if wait timed out
                console.warn('PUPPETEER: Did not detect successful navigation. Final URL:', finalUrl, 'Wait Error:', e.message.split('\n')[0]);
            }

            console.log('PUPPETEER: Final URL after login attempt logic:', finalUrl);
            await page.screenshot({ path: `puppeteer_login_2_aftersubmit_${ts}.png` });

            if (loginSuccess && (finalUrl.includes('/az/noteandannounce') || finalUrl.includes('/az/index'))) {
                console.log('UNEC_CLIENT (Puppeteer): Login successful!');
                const browserCookies = await page.cookies(BASE_URL);
                const cookieJar = new CookieJar();
                for (const cookie of browserCookies) {
                    const cookieString = `${cookie.name}=${cookie.value}`;
                    try {
                        // Make sure to use the correct URL for setting cookies in the jar for later axios requests
                        await cookieJar.setCookie(cookieString, `${BASE_URL}${cookie.path}`);
                    } catch (cookieSetError) {
                        console.warn("Error setting cookie in tough-cookie jar:", cookieSetError.message, "Cookie:", cookieString, "Domain:", cookie.domain, "Path:", cookie.path);
                    }
                }
                // Log the PHPSESSID from the new jar
                const authSessId = (await cookieJar.getCookies(BASE_URL)).find(c=>c.key==='PHPSESSID');
                console.log("UNEC_CLIENT (Puppeteer): Authenticated PHPSESSID from jar:", authSessId ? authSessId.value : "Not found in jar");
                return { success: true, authenticatedCookieJar: cookieJar, message: "Login successful via Puppeteer." };
            } else {
                const pageContent = await page.content();
                // Save full HTML for inspection
                // import fs from 'fs'; fs.writeFileSync(`puppeteer_3_failure_page_${ts}.html`, pageContent);
                console.log(`UNEC_CLIENT (Puppeteer): Login failed. Landed on: ${finalUrl}. HTML (first 1000 chars):`, pageContent.substring(0,1000));
                const $ = cheerio.load(pageContent);
                const loginError = $('.alert-danger').text()?.trim() || $('.errorSummary ul li').first().text()?.trim();
                const message = loginError || `Login via Puppeteer failed. Landed on: ${finalUrl}`;
                console.warn('UNEC_CLIENT (Puppeteer): Login failed diagnosis:', message);
                return { success: false, authenticatedCookieJar: null, message: message };
            }
        } catch (error) {
            console.error('UNEC_CLIENT (Puppeteer): Outer error during login:', error.message, error.stack ? error.stack.split('\n').slice(0,3) : '');
            if(page) await page.screenshot({ path: `puppeteer_4_error_state_${ts}.png` }).catch(e => console.error("Screenshot on error failed:", e));
            return { success: false, authenticatedCookieJar: null, message: `Puppeteer login error: ${error.message}` };
        } finally {
            const DEBUG_MODE_PUPPETEER = false; // Keep true for debugging this
            if (browser && browser.isConnected()) {
                if (DEBUG_MODE_PUPPETEER) {
                    console.log("UNEC_CLIENT (Puppeteer): DEBUG MODE - Browser will stay open for 60s. Close manually or wait.");
                    // await new Promise(resolve => setTimeout(resolve, 10000)); // 60 seconds
                    if (browser.isConnected()) await browser.close().catch(e => console.error("Error closing browser in finally:",e));
                } else {
                    await browser.close().catch(e => console.error("Error closing browser in finally:",e));
                    console.log('UNEC_CLIENT (Puppeteer): Browser closed.');
                }
            } else {
                 console.log('UNEC_CLIENT (Puppeteer): Browser not connected or already closed in finally.');
            }
        }
    },

    // --- Axios-based methods for subsequent requests using the authenticated cookieJar ---
    async fetchAuthedPage(urlPath, cookieJar) {
        const fullUrl = urlPath.startsWith('http') ? urlPath : BASE_URL + urlPath;
        console.log(`UNEC_CLIENT (Axios): Fetching authed page: GET ${fullUrl}`);
        
        try {
            const cookieString = await cookieJar.getCookieString(fullUrl);
            const headers = {
                ...defaultGetHeaders,
                'Cookie': cookieString
            };
            console.log(`UNEC_CLIENT (Axios): Using Cookie header for GET ${fullUrl}: ${cookieString ? cookieString.substring(0, 50) + '...' : 'None'}`);

            const response = await axios.get(fullUrl, { headers: headers });
            return response.data;
        } catch (error) { 
            console.error(`UNEC_CLIENT (Axios): Error fetching ${fullUrl}: ${error.message}`); 
            if (error.response) {
                console.error(`UNEC_CLIENT (Axios): Response status: ${error.response.status}`);
                // console.error(`UNEC_CLIENT (Axios): Response headers:`, JSON.stringify(error.response.headers, null, 2));
                if (typeof error.response.data === 'string' && error.response.data.toLowerCase().includes('loginform')) {
                    console.error(`UNEC_CLIENT (Axios): Response data snippet (likely login page): ${error.response.data.substring(0, 300)}...`);
                }
            }
            throw error; 
        }
    },

    async getSemesters(yearId, cookieJar, csrfToken) { // csrfToken might be needed here
        const url = BASE_URL + GET_EDU_SEMESTER_PATH;
        console.log(`UNEC_CLIENT (Axios): Fetching semesters via POST for yearId ${yearId} from ${url}`);
        const formData = new URLSearchParams();
        formData.append('type', 'eduYear'); formData.append('id', yearId);
        // if (csrfToken) formData.append('YII_CSRF_TOKEN', csrfToken); // Add if UNEC requires CSRF for this POST

        const cookieString = await cookieJar.getCookieString(url);
        const headersForSemesterPost = {
            ...defaultPostHeaders, 
            Referer: BASE_URL + STUDENT_EVAL_PATH, 
            'X-Requested-With': 'XMLHttpRequest',
            'Cookie': cookieString
        };
        console.log(`UNEC_CLIENT (Axios): Using Cookie header for POST ${url}: ${cookieString ? cookieString.substring(0, 50) + '...' : 'None'}`);
        // if (csrfToken) headersForSemesterPost['X-YII-CSRF-TOKEN'] = csrfToken; // Example if CSRF is via header for AJAX

        try {
            const response = await axios.post(url, formData.toString(), { headers: headersForSemesterPost });
            if (!response.data) throw new Error("Empty response from getEduSemester POST.");
            console.log("UNEC_CLIENT (Axios): Raw HTML from getEduSemester POST (first 300):", response.data.substring(0,300));
            return _extractSemestersFromOptionsHtml(response.data);
        } catch (error) { console.error(`UNEC_CLIENT (Axios): Error in getSemesters for year ${yearId}: ${error.message}`); throw error; }
    },

    async getSubjectModalData(subjectId, eduFormId, cookieJar, csrfToken) {
        const url = BASE_URL + STUDENT_EVAL_POPUP_PATH;
        console.log(`UNEC_CLIENT (Axios): Fetching modal data for subject ${subjectId}, eduFormId ${eduFormId} from ${url}`);
        const formData = new URLSearchParams();
        formData.append('id', subjectId); formData.append('lessonType', ''); formData.append('edu_form_id', eduFormId);

        const cookieString = await cookieJar.getCookieString(url);
        const headersForModalPost = {
            ...defaultPostHeaders, 
            Referer: BASE_URL + STUDENT_EVAL_PATH, 
            'X-Requested-With': 'XMLHttpRequest',
            'Cookie': cookieString 
        };
        console.log(`UNEC_CLIENT (Axios): Using Cookie header for POST ${url}: ${cookieString ? cookieString.substring(0, 50) + '...' : 'None'}`);

        if (csrfToken) {
             formData.append('YII_CSRF_TOKEN', csrfToken); // Standard Yii form CSRF
             // if you suspect it needs header CSRF too for AJAX:
             // headersForModalPost['X-YII-CSRF-TOKEN'] = csrfToken;
             console.log("UNEC_CLIENT (Axios): Using CSRF for modal POST:", csrfToken);
        } else {
            console.warn("UNEC_CLIENT (Axios): No CSRF provided for modal POST. It may fail.");
        }
        try {
            const response = await axios.post(url, formData.toString(), { headers: headersForModalPost });
            if (!response.data) throw new Error(`Empty modal HTML for subject ${subjectId}`);
            return _extractFinalEvalDataFromModalHtml(response.data);
        } catch (error) { console.error(`UNEC_CLIENT (Axios): Error in getSubjectModalData for subject ${subjectId}: ${error.message}`); throw error; }
    },

    // Function to get student evaluation URL from note/announce page
async getStudentEvalUrlFromNotePageHTML(pageHtml, cookieJar) {
    if (!pageHtml) throw new Error('UNEC_CLIENT: HTML for note/announce page is empty.');
    
    const $ = cheerio.load(pageHtml);
    
    // Try multiple selectors to find the evaluation link
    const selectors = [
        '.sidebar-menu a[href*="/studentEvaluation"]',
        'a[href*="/studentEvaluation"]',
        '.sidebar a[href*="/studentEvaluation"]',
        '.menu a[href*="/studentEvaluation"]',
        'a[href*="studentEvaluation"]'
    ];
    
    let evalLink = null;
    let usedSelector = '';
    
    for (const selector of selectors) {
        evalLink = $(selector);
        if (evalLink.length > 0) {
            usedSelector = selector;
            console.log(`UNEC_CLIENT: Found evaluation link using selector: ${selector}`);
            break;
        }
    }
    
    if (!evalLink || evalLink.length === 0) {
        // Log the page structure for debugging
        console.log('UNEC_CLIENT: Available links on page:');
        $('a[href*="student"]').each((i, el) => {
            console.log(`  - ${$(el).attr('href')} : ${$(el).text().trim()}`);
        });
        
        throw new Error('UNEC_CLIENT: Could not find student evaluation link in any expected location. Check the page HTML structure.');
    }
    
    const href = evalLink.first().attr('href');
    if (!href || typeof href !== 'string') {
        throw new Error('UNEC_CLIENT: Invalid href for evaluation link.');
    }
    
    // Convert relative URL to absolute
    const fullUrl = href.startsWith('http') ? href : new URL(href, BASE_URL).href;
    console.log('UNEC_CLIENT: Found student evaluation URL:', fullUrl);
    return fullUrl;
},

    // Function to extract academic years from evaluation page
    async extractYearsFromEvalPageHTML(pageHtml) {
        if (!pageHtml) throw new Error('UNEC_CLIENT: HTML for year extraction is empty.');
        
        const $ = cheerio.load(pageHtml);
        const years = [];
        
        $('#eduYear option').each((i, el) => {
            const value = $(el).val();
            const text = $(el).text().trim();
            if (value && value.trim() !== "") {
                years.push({ value, text });
            }
        });
        
        // Sort by year (newest first)
        years.sort((a, b) => {
            const yearA = parseInt(a.text.split(' - ')[0]);
            const yearB = parseInt(b.text.split(' - ')[0]);
            return yearB - yearA;
        });
        
        console.log('UNEC_CLIENT: Extracted years count:', years.length);
        return years;
    },

// Update the fetchInitialAcademicData function
async fetchInitialAcademicData(cookieJar, startingUrl = null) {
    console.log('UNEC_CLIENT: Fetching initial academic data...');
    
    let studentEvaluationPageUrl;
    let initialHtmlForYears;
    
    try {
        // Always start from note/announce page to get the evaluation link
        const noteAndAnnounceUrl = startingUrl || (BASE_URL + '/az/noteandannounce');
        
        console.log('UNEC_CLIENT: Starting from note/announce page:', noteAndAnnounceUrl);
        const noteHtml = await this.fetchAuthedPage(noteAndAnnounceUrl, cookieJar);
        
        if (!noteHtml) {
            throw new Error('Failed to fetch note/announce page HTML');
        }
        console.log('UNEC_CLIENT: Fetched note/announce page HTML (first 300 chars):', typeof noteHtml === 'string' ? noteHtml.substring(0, 300) : '[Non-string response]'); 
        
        // Extract the evaluation link from the note/announce page sidebar
        const evaluationLinkHref = _extractEvaluationLinkHref(noteHtml);
        
        // Convert relative URL to absolute
        studentEvaluationPageUrl = evaluationLinkHref.startsWith('http') 
            ? evaluationLinkHref 
            : new URL(evaluationLinkHref, BASE_URL).href;
        
        console.log('UNEC_CLIENT: Student evaluation URL found:', studentEvaluationPageUrl);
        
        // Now fetch the actual evaluation page to get years
        initialHtmlForYears = await this.fetchAuthedPage(studentEvaluationPageUrl, cookieJar);
        
        if (!initialHtmlForYears) {
            throw new Error('Failed to fetch initial evaluation page HTML');
        }
        
        console.log('UNEC_CLIENT: Successfully fetched evaluation page for year extraction');
        
        // Extract academic years
        const allYears = await this.extractYearsFromEvalPageHTML(initialHtmlForYears);
        if (!allYears || allYears.length === 0) {
            throw new Error('No academic years found on the page');
        }
        
        // Select the most recent year (first in sorted array)
        const selectedYear = allYears[0];
        console.log(`UNEC_CLIENT: Selected Year: ${selectedYear.text} (ID: ${selectedYear.value})`);
        
        // Extract CSRF token for future requests
        const csrfToken = this.parsers.extractCsrfToken(initialHtmlForYears);
        if (csrfToken) {
            console.log('UNEC_CLIENT: CSRF token found for future requests');
        } else {
            console.warn('UNEC_CLIENT: No CSRF token found on initial page');
        }
        
        return {
            success: true,
            data: {
                studentEvaluationPageUrl,
                allYears,
                selectedYear,
                csrfToken,
                initialHtml: initialHtmlForYears
            }
        };
        
    } catch (error) {
        console.error('UNEC_CLIENT: Error fetching initial academic data:', error);
        return {
            success: false,
            error: error.message
        };
    }
},
 
    parsers: {
        extractYears: _extractYears,
        extractSubjects: _extractSubjects,
        extractCsrfToken: _extractCsrfTokenFromHtml,
        extractSemestersFromOptions: _extractSemestersFromOptionsHtml,
        extractFinalEvalData: _extractFinalEvalDataFromModalHtml,
        extractEvaluationLinkHref: _extractEvaluationLinkHref // Add the new parser here
    }
};

export default unecClient;