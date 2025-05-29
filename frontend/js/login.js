document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const loginButton = document.getElementById('loginButton');
    const loginErrorDiv = document.getElementById('loginError');

    if (loginForm) {
        loginForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            loginErrorDiv.style.display = 'none';
            loginErrorDiv.textContent = '';
            loginButton.disabled = true;
            loginButton.textContent = 'Logging in...';

            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;

            if (!username || !password) {
                loginErrorDiv.textContent = 'Please enter both username and password.';
                loginErrorDiv.style.display = 'block';
                loginButton.disabled = false;
                loginButton.textContent = 'Login';
                return;
            }

            try {
                const response = await fetch('/api/auth/login', {
                    method: 'POST', // Correctly uses POST
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ username, password }),
                    credentials: 'include' 
                });

                const result = await response.json();

                if (response.ok && result.success) {
                    // Login successful
                    console.log('Login successful, redirecting to dashboard...');
                    window.location.href = 'dashboard.html'; 
                } else {
                    // Login failed
                    loginErrorDiv.textContent = result.message || 'Login failed. Please check your credentials.';
                    loginErrorDiv.style.display = 'block';
                }
            } catch (error) {
                console.error('Login request failed:', error);
                loginErrorDiv.textContent = 'An error occurred during login. Please try again.';
                loginErrorDiv.style.display = 'block';
            } finally {
                loginButton.disabled = false;
                loginButton.textContent = 'Login';
            }
        });
    }
});
