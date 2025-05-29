document.addEventListener('DOMContentLoaded', function() {
    const academicInfoDiv = document.getElementById('academicInfo');
    const subjectsTableBody = document.getElementById('subjectsTableBody');
    const refreshBtn = document.getElementById('refreshBtn');
    const logoutBtn = document.getElementById('logoutBtn');

    // Check authentication
    async function checkAuth() {
        try {
            const response = await fetch('/api/auth/check');
            const result = await response.json();
            
            if (!result.success) {
                window.location.href = '/login.html';
                return false;
            }
            return true;
        } catch (error) {
            console.error('Auth check failed:', error);
            window.location.href = '/login.html';
            return false;
        }
    }

    // Fetch and display student data
    async function fetchAndDisplayData(useCache = false) {
        if (!await checkAuth()) return;

        try {
            academicInfoDiv.innerHTML = '<div class="loading">Loading academic data...</div>';
            subjectsTableBody.innerHTML = '';

            const url = useCache ? '/api/academic/student-data?useCache=true' : '/api/academic/student-data';
            const response = await fetch(url);
            const result = await response.json();

            if (!result.success) {
                throw new Error(result.message || 'Failed to fetch student data');
            }

            displayStudentData(result.data);

        } catch (error) {
            console.error('Error fetching student data:', error);
            academicInfoDiv.innerHTML = `<div class="error">Error: ${error.message}</div>`;
        }
    }

    function displayStudentData(data) {
        // Display academic information
        let academicHtml = '';
        if (data.selectedYear) {
            academicHtml += `<p><strong>Academic Year:</strong> ${data.selectedYear.text}</p>`;
        }
        if (data.selectedSemester) {
            academicHtml += `<p><strong>Semester:</strong> ${data.selectedSemester.text}</p>`;
        }
        
        if (academicHtml) {
            academicInfoDiv.innerHTML = academicHtml;
        } else {
            academicInfoDiv.innerHTML = '<div class="error">No academic information available</div>';
        }

        // Display subjects table
        const tableBody = document.getElementById('subjectsTableBody');
        tableBody.innerHTML = '';

        if (data.subjectsWithGrades && data.subjectsWithGrades.length > 0) {
            data.subjectsWithGrades.forEach((subject, index) => {
                const row = tableBody.insertRow();
                row.insertCell().textContent = index + 1;
                row.insertCell().textContent = subject.name || 'N/A';
                row.insertCell().textContent = subject.id || 'N/A';
                row.insertCell().textContent = subject.edu_form_id || 'N/A';
                row.insertCell().textContent = subject.qaibFaizi !== undefined && subject.qaibFaizi !== null ? subject.qaibFaizi : 'N/A';
                
                // Current Evaluation cell - now using data directly from backend
                const currentEvalCell = row.insertCell();
                currentEvalCell.textContent = subject.currentEvaluation || 'N/A';
            });
        } else {
            const row = tableBody.insertRow();
            const cell = row.insertCell();
            cell.colSpan = 6;
            cell.textContent = data.message || 'No subjects found for this semester.';
            cell.style.textAlign = 'center';
            cell.style.fontStyle = 'italic';
        }
    }

    // Event listeners
    refreshBtn.addEventListener('click', () => {
        fetchAndDisplayData(false); // Force fresh data
    });

    logoutBtn.addEventListener('click', async () => {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            window.location.href = '/login.html';
        }
    });

    // Initial load
    fetchAndDisplayData(true); // Try cache first
});
