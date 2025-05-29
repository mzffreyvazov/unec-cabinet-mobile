// backend/routes/academic.js
import express from 'express';
import unecClient from '../services/unecClient.js';
import appAuthMiddleware from '../middleware/auth.js';
import { CookieJar } from 'tough-cookie'; // For deserializing

const router = express.Router();

// Add this route before your existing /student-data route
router.get('/initial-data', appAuthMiddleware, async (req, res) => {
    try {
        console.log('ACADEMIC_ROUTE: /initial-data called for user:', req.session.user.username);
        
        if (!req.session.unecAuth || !req.session.unecAuth.cookieJarJson) {
            throw new Error('UNEC authentication data not found in session.');
        }
        
        // Deserialize the cookieJar from the session
        const cookieJar = CookieJar.deserializeSync(req.session.unecAuth.cookieJarJson);
        console.log('ACADEMIC_ROUTE: Deserialized UNEC cookie jar for initial data fetch.');
        
        // Get starting URL from query parameter if provided
        const startingUrl = req.query.startingUrl || null;
        
        // Fetch initial academic data (years, evaluation URL, etc.)
        const result = await unecClient.fetchInitialAcademicData(cookieJar, startingUrl);
        
        if (!result.success) {
            throw new Error(result.error);
        }
        
        console.log('ACADEMIC_ROUTE: Successfully fetched initial academic data');
        res.json({
            success: true,
            data: {
                evaluationPageUrl: result.data.studentEvaluationPageUrl,
                years: result.data.allYears,
                selectedYear: result.data.selectedYear,
                csrfToken: result.data.csrfToken
            }
        });
        
    } catch (error) {
        console.error('ACADEMIC_ROUTE: Error in /initial-data:', error.message);
        res.status(500).json({ 
            success: false, 
            message: error.message || 'Failed to fetch initial academic data.' 
        });
    }
});

router.get('/student-data', appAuthMiddleware, async (req, res) => {
    let fullProcessStartTime = Date.now();
    try {
        console.log('ACADEMIC_ROUTE: /student-data called for user:', req.session.user.username);
        if (!req.session.unecAuth || !req.session.unecAuth.cookieJarJson) {
            throw new Error('UNEC authentication data not found in session.');
        }
        // Deserialize the cookieJar from the session
        const cookieJar = CookieJar.deserializeSync(req.session.unecAuth.cookieJarJson);
        console.log('ACADEMIC_ROUTE: Deserialized UNEC cookie jar for subsequent requests.');

        let studentEvaluationPageUrl = unecClient.BASE_URL + '/az/studentEvaluation'; // Default starting point
        let initialHtml, htmlWithSubjects, csrfTokenForPost;

        // 1. Fetch initial evaluation page for years AND potential CSRF token for /getEduSemester
        console.log('ACADEMIC_ROUTE: Fetching initial evaluation page for years:', studentEvaluationPageUrl);
        initialHtml = await unecClient.fetchAuthedPage(studentEvaluationPageUrl, cookieJar);
        if (!initialHtml) throw new Error("Failed to fetch initial evaluation page HTML.");

        csrfTokenForPost = unecClient.parsers.extractCsrfToken(initialHtml); // For /getEduSemester
        if (csrfTokenForPost) console.log("ACADEMIC_ROUTE: CSRF from initial eval page:", csrfTokenForPost);
        else console.warn("ACADEMIC_ROUTE: No CSRF token found on initial eval page. /getEduSemester POST might need it differently or not at all.");

        // 2. Extract Years
        const allYears = unecClient.parsers.extractYears(initialHtml);
        if (!allYears || allYears.length === 0) throw new Error("No academic years found.");
        const selectedYear = allYears[0]; // Most recent
        console.log('ACADEMIC_ROUTE: Selected Year:', selectedYear.text, `(ID: ${selectedYear.value})`);

        // 3. Get Semesters (POST to /getEduSemester)
        // Pass the csrfTokenFromPage (which is csrfTokenForPost here)
        const semestersForSelectedYear = await unecClient.getSemesters(selectedYear.value, cookieJar, csrfTokenForPost);
        if (!semestersForSelectedYear || semestersForSelectedYear.length === 0) {
            console.warn(`ACADEMIC_ROUTE: No semesters found for year ${selectedYear.text}.`);
            // Return what we have so far, or an error/empty state
            return res.json({ success: true, data: { selectedYear, selectedSemester: null, subjectsWithGrades: [], message: "No semesters found." } });
        }

        // Prioritize "II semestr" or "Yaz", then fall back to the last semester in the list
        let selectedSemester = 
            semestersForSelectedYear.find(s => s.text.includes("II semestr")) ||
            semestersForSelectedYear.find(s => s.text.toLowerCase().includes("yaz")) || // "Yaz" (Spring)
            (semestersForSelectedYear.length > 0 ? semestersForSelectedYear[semestersForSelectedYear.length - 1] : null);
        
        // As a final fallback if the above logic results in null (e.g. empty array initially, though checked)
        // or if specific keywords aren't present and we want to ensure we pick *something* if available.
        // The previous logic already handles empty array by assigning null.
        // If only "I semestr" or "Payız" is available, the last element logic would pick it.
        if (!selectedSemester && semestersForSelectedYear.length > 0) {
            // This case should ideally be covered by `semestersForSelectedYear[semestersForSelectedYear.length - 1]`
            // but as an explicit fallback if the list has items but no keywords matched.
            selectedSemester = semestersForSelectedYear[semestersForSelectedYear.length - 1];
        }

        if (!selectedSemester) throw new Error("Could not determine a selected semester from the available options.");
        console.log('ACADEMIC_ROUTE: Selected Semester:', selectedSemester.text, `(ID: ${selectedSemester.value})`);

        // 4. Get Subjects Page HTML (this page might have a new CSRF for modal popups)
        const subjectsPageUrl = `${studentEvaluationPageUrl}?eduYear=${selectedYear.value}&eduSemester=${selectedSemester.value}`;
        console.log('ACADEMIC_ROUTE: Fetching subjects page HTML from:', subjectsPageUrl);
        htmlWithSubjects = await unecClient.fetchAuthedPage(subjectsPageUrl, cookieJar);
        if (!htmlWithSubjects) throw new Error("Failed to fetch subjects page HTML.");

        // Extract CSRF token from THIS page for the modal popups
        const csrfForModals = unecClient.parsers.extractCsrfToken(htmlWithSubjects);
        if (csrfForModals) console.log("ACADEMIC_ROUTE: CSRF token from subjects page (for modals):", csrfForModals);
        else console.warn("ACADEMIC_ROUTE: No CSRF token found on subjects page. Modal POSTs might fail if required.");

        // 5. Extract Subjects (should include edu_form_id)
        const subjects = unecClient.parsers.extractSubjects(htmlWithSubjects);
        console.log('ACADEMIC_ROUTE: Subjects found:', subjects.length);
        if (subjects.length === 0) {
             return res.json({ success: true, data: { selectedYear, selectedSemester, subjectsWithGrades: [], message: "No subjects found for this semester." } });
        }

        // 6. Loop through subjects and get modal data (Qaib Faizi)
        let subjectsWithGrades = [];
        const subjectsToProcess = subjects; // Process all extracted subjects
        console.log(`ACADEMIC_ROUTE: Will fetch modal data for ${subjectsToProcess.length} subjects.`);

        for (const subject of subjectsToProcess) {
            if (!subject.id || !subject.edu_form_id) {
                console.warn("ACADEMIC_ROUTE: Skipping subject due to missing id or edu_form_id:", subject.name);
                subjectsWithGrades.push({ 
                    name: subject.name || "Unknown Subject", 
                    id: subject.id || "N/A", 
                    edu_form_id: subject.edu_form_id,
                    qaibFaizi: 'Data Error (Missing ID/FormID)',
                    currentEvaluation: 'N/A'
                });
                continue;
            }
            try {
                console.log(`ACADEMIC_ROUTE: Fetching modal for subject: ${subject.name} (ID: ${subject.id}, eduFormId: ${subject.edu_form_id})`);
                
                // Fetch both qaib faizi and current evaluation from the same modal
                const modalEvalData = await unecClient.getSubjectModalData(subject.id, subject.edu_form_id, cookieJar, csrfForModals);
                
                subjectsWithGrades.push({
                    name: subject.name,
                    id: subject.id,
                    edu_form_id: subject.edu_form_id,
                    qaibFaizi: modalEvalData.qaibFaizi !== null ? modalEvalData.qaibFaizi : 'N/A',
                    currentEvaluation: modalEvalData.currentEvaluation !== undefined ? modalEvalData.currentEvaluation : 'N/A'
                });
                await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 200)); // Small delay
            } catch (modalError) {
                console.error(`ACADEMIC_ROUTE: Error fetching/parsing modal for ${subject.name}: ${modalError.message}`);
                subjectsWithGrades.push({ 
                    name: subject.name, 
                    id: subject.id, 
                    edu_form_id: subject.edu_form_id, 
                    qaibFaizi: 'Fetch Error',
                    currentEvaluation: 'Fetch Error'
                });
            }
        }
        console.log("ACADEMIC_ROUTE: Total processing time:", (Date.now() - fullProcessStartTime)/1000, "s");
        res.json({
            success: true,
            data: { selectedYear, selectedSemester, subjectsWithGrades }
        });

    } catch (error) {
        console.error('ACADEMIC_ROUTE: Overall error in /student-data:', error.message, error.stack ? error.stack.substring(0,300) : '');
        res.status(500).json({ success: false, message: error.message || 'Failed to fetch all student data.' });
    }
});

export default router;