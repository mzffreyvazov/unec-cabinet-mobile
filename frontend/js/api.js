// frontend/js/dashboard.js (Conceptual - integrate with your actual dashboard.js)

// This function would be called after successful login and redirection to dashboard.html
async function loadDashboardData() {
    const loadingDiv = document.getElementById('loading'); // Assuming you have these
    const errorDiv = document.getElementById('error');
    const summaryContainer = document.getElementById('summary-container');
    const selectedYearSemesterText = document.getElementById('selectedYearSemesterText');
    const gradesTableBody = document.getElementById('gradesTableBody');

    if (loadingDiv) loadingDiv.style.display = 'block';
    if (errorDiv) errorDiv.style.display = 'none';
    if (summaryContainer) summaryContainer.style.display = 'none';
    if (gradesTableBody) gradesTableBody.innerHTML = '';

    try {
        // This fetch will automatically include the session cookie set by /api/auth/login
        const response = await fetch('/api/academic/student-data', { // Assuming backend is on same origin or CORS is set
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                // 'Authorization': 'Bearer your_token_if_using_token_auth' // Not needed for cookie sessions
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                // Unauthorized, likely session expired or not logged in via proxy
                showErrorOnDashboard("Session expired or not logged in. Please log in again.");
                // Optionally redirect to login: window.location.href = 'login.html';
                return;
            }
            const errData = await response.json().catch(() => ({ message: `HTTP error ${response.status}`}));
            throw new Error(errData.message || `Failed to load dashboard data: ${response.statusText}`);
        }

        const result = await response.json();
        console.log("DASHBOARD: Data received:", result);

        if (result.success && result.data) {
            const { selectedYear, selectedSemester, subjectsWithGrades } = result.data;
            if (selectedYearSemesterText) {
                 selectedYearSemesterText.textContent = `${selectedYear?.text || 'N/A'} / ${selectedSemester?.text || 'N/A'}`;
            }

            if (subjectsWithGrades && Array.isArray(subjectsWithGrades)) {
                if (gradesTableBody) displayGradesTable(subjectsWithGrades); // Your existing display function
                if (summaryContainer) summaryContainer.style.display = 'block';
            } else {
                showErrorOnDashboard("No subject data received.");
            }
        } else {
            showErrorOnDashboard(result.message || "Failed to process dashboard data.");
        }

    } catch (error) {
        console.error("DASHBOARD: Error fetching/displaying data:", error);
        showErrorOnDashboard(error.message);
    } finally {
        if (loadingDiv) loadingDiv.style.display = 'none';
    }
}

function displayGradesTable(subjects) { // Make sure this matches your popup.js version
    const gradesTableBody = document.getElementById('gradesTableBody');
    if (!gradesTableBody) return;
    gradesTableBody.innerHTML = '';
    subjects.forEach(subject => {
        const row = gradesTableBody.insertRow();
        row.insertCell().textContent = subject.name || 'N/A';
        row.insertCell().textContent = subject.qaibFaizi !== undefined ? subject.qaibFaizi : 'N/A';
    });
}

function showErrorOnDashboard(message) {
    const errorDiv = document.getElementById('error');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }
    console.error("DASHBOARD ERROR:", message);
}

// Call this when dashboard.html loads
// document.addEventListener('DOMContentLoaded', loadDashboardData);
// Or if you have a button on dashboard to refresh:
// document.getElementById('refreshDataBtn').addEventListener('click', loadDashboardData);