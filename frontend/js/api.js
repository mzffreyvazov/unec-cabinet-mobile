// frontend/js/dashboard.js (Conceptual - integrate with your actual dashboard.js)
// Function to show error on dashboard
function showErrorOnDashboard(message) {
    const errorDiv = document.getElementById('error');
    const loadingDiv = document.getElementById('loading');
    const summaryContainer = document.getElementById('summary-container');
    
    if (loadingDiv) loadingDiv.style.display = 'none';
    if (summaryContainer) summaryContainer.style.display = 'none';
    
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }
}

// Function to display grades table
function displayGradesTable(subjects) {
    const tbody = document.getElementById('gradesTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (!subjects || subjects.length === 0) {
        const row = tbody.insertRow();
        const cell = row.insertCell(0);
        cell.colSpan = 2;
        cell.textContent = 'No subjects found';
        cell.style.textAlign = 'center';
        return;
    }
    
    subjects.forEach(subject => {
        const row = tbody.insertRow();
        const nameCell = row.insertCell(0);
        const gradeCell = row.insertCell(1);
        
        nameCell.textContent = subject.name || 'Unknown Subject';
        gradeCell.textContent = subject.qaibFaizi || 'N/A';
    });
}


// Function to fetch initial academic data (years, evaluation URL)
async function loadInitialAcademicData(startingUrl = null) {
    try {
        const queryParam = startingUrl ? `?startingUrl=${encodeURIComponent(startingUrl)}` : '';
        const response = await fetch(`/api/academic/initial-data${queryParam}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include'
        });

        if (!response.ok) {
            if (response.status === 401) {
                throw new Error("Session expired or not logged in. Please log in again.");
            }
            const errData = await response.json().catch(() => ({ message: `HTTP error ${response.status}`}));
            throw new Error(errData.message || `Failed to load initial data: ${response.statusText}`);
        }

        const result = await response.json();
        console.log("FRONTEND: Initial academic data received:", result);

        if (result.success && result.data) {
            return {
                success: true,
                evaluationPageUrl: result.data.evaluationPageUrl,
                years: result.data.years,
                selectedYear: result.data.selectedYear,
                csrfToken: result.data.csrfToken
            };
        } else {
            throw new Error(result.message || "Failed to process initial academic data");
        }

    } catch (error) {
        console.error("FRONTEND: Error fetching initial academic data:", error);
        throw error;
    }
}



// Update your existing loadDashboardData function to use this
async function loadDashboardData() {
    const loadingDiv = document.getElementById('loading');
    const errorDiv = document.getElementById('error');
    const summaryContainer = document.getElementById('summary-container');
    const selectedYearSemesterText = document.getElementById('selectedYearSemesterText');
    const gradesTableBody = document.getElementById('gradesTableBody');

    if (loadingDiv) loadingDiv.style.display = 'block';
    if (errorDiv) errorDiv.style.display = 'none';
    if (summaryContainer) summaryContainer.style.display = 'none';
    if (gradesTableBody) gradesTableBody.innerHTML = '';

    try {
        // First, test the initial data endpoint
        console.log("FRONTEND: Testing initial academic data endpoint...");
        const initialData = await loadInitialAcademicData();
        
        console.log("FRONTEND: Initial data success! Got years:", initialData.years?.length || 0);
        console.log("FRONTEND: Selected year:", initialData.selectedYear?.text || 'None');
        
        if (selectedYearSemesterText) {
            selectedYearSemesterText.textContent = `${initialData.selectedYear?.text || 'Loading...'} / Loading semester...`;
        }
        
        // For now, just show the initial data success
        if (summaryContainer) summaryContainer.style.display = 'block';
        
        // Now proceed with full student data fetch
        console.log("FRONTEND: Now fetching full student data...");
        const response = await fetch('/api/academic/student-data', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include'
        });

        if (!response.ok) {
            if (response.status === 401) {
                showErrorOnDashboard("Session expired or not logged in. Please log in again.");
                return;
            }
            const errData = await response.json().catch(() => ({ message: `HTTP error ${response.status}`}));
            throw new Error(errData.message || `Failed to load dashboard data: ${response.statusText}`);
        }

        const result = await response.json();
        console.log("FRONTEND: Full academic data received:", result);

        if (result.success && result.data) {
            const { selectedYear, selectedSemester, subjectsWithGrades } = result.data;
            if (selectedYearSemesterText) {
                selectedYearSemesterText.textContent = `${selectedYear?.text || 'N/A'} / ${selectedSemester?.text || 'N/A'}`;
            }

            if (subjectsWithGrades && Array.isArray(subjectsWithGrades)) {
                displayGradesTable(subjectsWithGrades);
            } else {
                showErrorOnDashboard("No subject data received.");
            }
        } else {
            showErrorOnDashboard(result.message || "Failed to process dashboard data.");
        }

    } catch (error) {
        console.error("FRONTEND: Error fetching/displaying data:", error);
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