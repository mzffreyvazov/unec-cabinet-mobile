// backend/routes/academic.js
import express from 'express';
import unecClient from '../services/unecClient.js';
import appAuthMiddleware from '../middleware/auth.js';
import { CookieJar } from 'tough-cookie';

const router = express.Router();

router.get('/student-data', appAuthMiddleware, async (req, res) => {
    try {
        console.log('ACADEMIC_ROUTE: /student-data called for user:', req.session.user.username);
        if (!req.session.unecAuth || !req.session.unecAuth.cookieJarJson) {
            throw new Error('UNEC authentication data not found in session.');
        }
        const cookieJar = CookieJar.deserializeSync(req.session.unecAuth.cookieJarJson);

        let studentEvaluationPageUrl = unecClient.BASE_URL + '/az/studentEvaluation';
        let initialHtml, htmlWithSubjects, csrfTokenFromPage;

        console.log('ACADEMIC_ROUTE: Fetching initial evaluation page:', studentEvaluationPageUrl);
        initialHtml = await unecClient.fetchAuthedPage(studentEvaluationPageUrl, cookieJar);
        
        csrfTokenFromPage = unecClient.parsers.extractCsrfToken(initialHtml); // Use exported parser
        if (csrfTokenFromPage) console.log("ACADEMIC_ROUTE: CSRF from initial eval page:", csrfTokenFromPage);
        else console.warn("ACADEMIC_ROUTE: No CSRF on initial eval page.");

        const allYears = unecClient.parsers.extractYears(initialHtml); // Use exported parser
        if (!allYears || allYears.length === 0) throw new Error("No academic years found.");
        const selectedYear = allYears[0];
        console.log('ACADEMIC_ROUTE: Selected Year:', selectedYear.text);

        // Pass the csrfTokenFromPage to getSemesters (it might be needed or not)
        const semestersForSelectedYear = await unecClient.getSemesters(selectedYear.value, cookieJar, csrfTokenFromPage);
        if (!semestersForSelectedYear || semestersForSelectedYear.length === 0) {
            console.warn(`ACADEMIC_ROUTE: No semesters for ${selectedYear.text}`);
            return res.json({ success: true, data: { selectedYear, selectedSemester: null, subjectsWithGrades: [] } });
        }
        const selectedSemester = semestersForSelectedYear.find(s => s.text.includes("I semestr") || s.text.includes("Payız")) || semestersForSelectedYear[0];
        if (!selectedSemester) throw new Error("Could not determine selected semester.");
        console.log('ACADEMIC_ROUTE: Selected Semester:', selectedSemester.text);

        const subjectsPageUrl = `${studentEvaluationPageUrl}?eduYear=${selectedYear.value}&eduSemester=${selectedSemester.value}`;
        console.log('ACADEMIC_ROUTE: Fetching subjects page:', subjectsPageUrl);
        htmlWithSubjects = await unecClient.fetchAuthedPage(subjectsPageUrl, cookieJar);
        
        // If CSRF wasn't found initially, try again from the subjects page HTML
        if (!csrfTokenFromPage) {
            csrfTokenFromPage = unecClient.parsers.extractCsrfToken(htmlWithSubjects);
            if (csrfTokenFromPage) console.log("ACADEMIC_ROUTE: CSRF from subjects page:", csrfTokenFromPage);
            else console.warn("ACADEMIC_ROUTE: No CSRF on subjects page either. Modal POSTs might fail.");
        }

        const subjects = unecClient.parsers.extractSubjects(htmlWithSubjects); // Use exported parser
        console.log('ACADEMIC_ROUTE: Subjects found:', subjects.length);

        let subjectsWithGrades = [];
        const subjectsToProcess = subjects.slice(0, req.query.limitSubjects || 3);
        console.log(`ACADEMIC_ROUTE: Will fetch modal data for ${subjectsToProcess.length} subjects.`);

        for (const subject of subjectsToProcess) {
            // ... (rest of the loop for getSubjectModalData, using csrfTokenFromPage)
            if (!subject.id || !subject.edu_form_id) { /* ... */ continue; }
            try {
                const modalEvalData = await unecClient.getSubjectModalData(subject.id, subject.edu_form_id, cookieJar, csrfTokenFromPage);
                subjectsWithGrades.push({ name: subject.name, id: subject.id, qaibFaizi: modalEvalData.qaibFaizi || 'N/A' });
                await new Promise(resolve => setTimeout(resolve, 200));
            } catch (modalError) { /* ... */ subjectsWithGrades.push({ name: subject.name, id: subject.id, qaibFaizi: 'Fetch Error' }); }
        }

        res.json({
            success: true,
            data: { selectedYear, selectedSemester, subjectsWithGrades }
        });

    } catch (error) {
        console.error('ACADEMIC_ROUTE: Error fetching student data:', error.message);
        res.status(500).json({ success: false, message: error.message || 'Failed to fetch student data.' });
    }
});

export default router;