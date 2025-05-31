// userAuth.js - handles all user-related operations
import { Client, Account, Users } from 'node-appwrite';
export default async function({ req, res, log, error: logError }) {
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

      case 'verifyAdmin':
        // Check if user has admin label
        const adminUser = await users.get(data.userId);
        const isAdmin = adminUser.labels && adminUser.labels.includes('admin');
        
        return res.json({
          success: true,
          isAdmin: isAdmin,
          userId: data.userId,
          action: 'verifyAdmin'
        });

      case 'getUsersByClass':
        // Get enrolled students for a specific class
        // This will parse the members array to get user details
        const memberDetails = [];
        
        if (data.members && Array.isArray(data.members)) {
          for (const memberStr of data.members) {
            try {
              const member = JSON.parse(memberStr);
              if (member.userId) {
                try {
                  const memberUser = await users.get(member.userId);
                  const memberPrefs = await users.getPrefs(member.userId);
                  
                  memberDetails.push({
                    userId: member.userId,
                    name: member.name || memberUser.name,
                    email: memberUser.email,
                    phone: memberPrefs.phone || '',
                    joinedAt: member.joinedAt || 'Unknown'
                  });
                } catch (userError) {
                  // If can't fetch user details, include basic info
                  memberDetails.push({
                    userId: member.userId,
                    name: member.name || 'Unknown',
                    email: 'Unknown',
                    phone: 'Unknown',
                    joinedAt: member.joinedAt || 'Unknown',
                    error: 'Could not fetch user details'
                  });
                }
              }
            } catch (parseError) {
              console.error('Error parsing member:', parseError);
            }
          }
        }
        
        return res.json({
          success: true,
          members: memberDetails,
          totalMembers: memberDetails.length,
          action: 'getUsersByClass'
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