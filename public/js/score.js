// Updating the score.html frontend to fetch from your API

// Function to search for a user
async function searchUser(searchTerm) {
  // Show loading state
  document.getElementById('loadingState').style.display = 'block';
  document.getElementById('profileCard').style.display = 'none';
  document.getElementById('noResults').style.display = 'none';
  
  try {
    // Fetch user details from your API
    const response = await fetch(`/api/users/${searchTerm}/score`);
    if (!response.ok) throw new Error('User not found');
    const userData = await response.json();
    
    // Fetch violations
    const violationsResponse = await fetch(`/api/users/${searchTerm}/violations`);
    const violationsData = await violationsResponse.json();
    
    // Fetch user summary
    const summaryResponse = await fetch(`/api/users/${searchTerm}/summary`);
    const summaryData = await summaryResponse.json();
    
    // Update profile card
    document.getElementById('userName').textContent = userData.username || searchTerm;
    document.getElementById('userId').textContent = `ID: ${searchTerm}`;
    document.getElementById('userInitial').textContent = (userData.username || searchTerm).charAt(0);
    document.getElementById('scoreValue').textContent = userData.score;
    
    // Update score circle class
    const scoreCircle = document.getElementById('scoreCircle');
    if (userData.score < 40) {
      scoreCircle.className = 'score-circle low';
      document.getElementById('userStatus').textContent = 'High Risk - Trust Score Below 40';
      document.getElementById('userStatus').className = 'profile-status status-danger';
    } else if (userData.score < 70) {
      scoreCircle.className = 'score-circle medium';
      document.getElementById('userStatus').textContent = 'Medium Risk - Trust Score Below 70';
      document.getElementById('userStatus').className = 'profile-status status-warning';
    } else {
      scoreCircle.className = 'score-circle high';
      document.getElementById('userStatus').textContent = 'Low Risk - Trust Score Above 70';
      document.getElementById('userStatus').className = 'profile-status status-success';
    }
    
    // Populate violation history
    populateViolations(violationsData.violations);
    
    // Show profile card
    document.getElementById('profileCard').style.display = 'block';
  } catch (error) {
    console.error('Error fetching user data:', error);
    document.getElementById('noResults').style.display = 'block';
  } finally {
    // Hide loading state
    document.getElementById('loadingState').style.display = 'none';
  }
}

// Load leaderboard from API
async function loadLeaderboard() {
  try {
    const response = await fetch('/api/leaderboard?limit=10');
    const data = await response.json();
    
    if (data.leaderboard && data.leaderboard.length > 0) {
      populateLeaderboard(data.leaderboard.map((user, index) => ({
        rank: index + 1,
        username: user.username,
        userId: user.user_id,
        avatar: user.avatar,
        score: user.score,
        lastViolation: 'Recent', // You would need to fetch this separately
        violations: ['scam'] // You would need to determine these from violations
      })));
    }
  } catch (error) {
    console.error('Error loading leaderboard:', error);
  }
}

// Initialize the page with data from your API
document.addEventListener('DOMContentLoaded', function() {
  // Load leaderboard from API
  loadLeaderboard();
  
  // Rest of your initialization code...
});