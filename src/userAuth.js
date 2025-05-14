// userAuth.js - handles all user-related operations
const { Client, Account, Users } = require('node-appwrite');

module.exports = async function(req, res) {
  const client = new Client()
    .setEndpoint('https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const users = new Users(client);
  const account = new Account(client);
  
  try {
    const { action, ...data } = JSON.parse(req.payload || '{}');
    
    switch (action) {
      case 'register':
        // Register new user
        const newUser = await users.create(
          'unique()', 
          data.email,
          data.password,
          data.name
        );
        
        // Add phone to preferences
        await users.updatePrefs(newUser.$id, { phone: data.phone });
        
        return res.json({
          success: true,
          userId: newUser.$id,
          action: 'register'
        });
        
      case 'login':
        // Server-side login implementation if needed
        // Note: Typically handled by client SDK
        return res.json({
          success: true,
          message: 'Login handled by client SDK',
          action: 'login'
        });
        
      case 'getProfile':
        // Get user profile data
        const user = await users.get(data.userId);
        const prefs = await users.getPrefs(data.userId);
        
        return res.json({
          success: true,
          user: {
            id: user.$id,
            name: user.name,
            email: user.email,
            phone: prefs.phone
          },
          action: 'getProfile'
        });
        
      default:
        throw new Error('Invalid action specified');
    }
  } catch (error) {
    console.error(`Error in user auth function (${req.payload?.action}):`, error);
    return res.json({
      success: false,
      message: `User auth operation failed: ${error.message}`,
      error: error.message
    }, 500);
  }
};
