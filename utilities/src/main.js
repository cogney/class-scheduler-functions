// utilities.js - miscellaneous helper functions
const { Client, Databases, Storage, Functions } = require('node-appwrite');

module.exports = async function(req, res) {
  const client = new Client()
    .setEndpoint('https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const databases = new Databases(client);
  const storage = new Storage(client);
  const functions = new Functions(client);
  
  try {
    const { action, ...data } = JSON.parse(req.payload || '{}');
    
    switch (action) {
      case 'generateStats':
        // Generate statistics about classes and availability
        const stats = await generateSystemStats(databases);
        
        return res.json({
          success: true,
          stats,
          action: 'generateStats'
        });
        
      case 'cleanupDatabase':
        // Archive old records, clean up unused data
        const cleanupResults = await cleanupOldRecords(databases);
        
        return res.json({
          success: true,
          results: cleanupResults,
          action: 'cleanupDatabase'
        });
        
      case 'triggerMatchCheck':
        // Manually trigger the match-checking process
        const matchResults = await triggerAvailabilityMatching(databases, functions);
        
        return res.json({
          success: true,
          results: matchResults,
          action: 'triggerMatchCheck'
        });
        
      case 'getSystemHealth':
        // Check system health - database, storage, etc.
        const health = await checkSystemHealth(client, databases, storage);
        
        return res.json({
          success: true,
          health,
          action: 'getSystemHealth'
        });
        
      default:
        throw new Error('Invalid action specified');
    }
  } catch (error) {
    console.error(`Error in utilities (${req.payload?.action}):`, error);
    return res.json({
      success: false,
      message: `Utility operation failed: ${error.message}`,
      error: error.message
    }, 500);
  }
};

// Implementation of helper functions...