// availabilityManagement.js - handles availability submission and matching
const { Client, Databases, Query, ID } = require('node-appwrite');

module.exports = async function(req, res) {
  const client = new Client()
    .setEndpoint('https://fra.appwrite.io/v1')
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const databases = new Databases(client);
  
  try {
    const { action, ...data } = JSON.parse(req.payload || '{}');
    
    switch (action) {
      case 'submitAvailability':
        // Save user's availability
        const availabilityDoc = await databases.createDocument(
          process.env.DATABASE_ID,
          process.env.AVAILABILITY_COLLECTION_ID,
          ID.unique(),
          {
            userId: data.userId,
            classType: data.classType,
            availabilities: data.availabilities,
            status: 'active',
            createdAt: new Date().toISOString()
          }
        );
        
        // Optionally trigger match checking
        // This could also be done via a scheduled function
        if (data.checkForMatches) {
          await checkForMatches(databases, data.userId, data.classType, data.availabilities);
        }
        
        return res.json({
          success: true,
          availabilityId: availabilityDoc.$id,
          action: 'submitAvailability'
        });
        
      case 'findMatches':
        // Find matching availabilities for a time slot
        const matches = await findMatchingUsers(
          databases, 
          data.classType, 
          data.day, 
          data.time, 
          data.excludeUserId
        );
        
        return res.json({
          success: true,
          matches: matches,
          action: 'findMatches'
        });
        
      case 'getUserAvailability':
        // Get a user's availability
        const userAvailability = await databases.listDocuments(
          process.env.DATABASE_ID,
          process.env.AVAILABILITY_COLLECTION_ID,
          [
            Query.equal('userId', data.userId),
            Query.equal('status', 'active')
          ]
        );
        
        return res.json({
          success: true,
          availabilities: userAvailability.documents,
          action: 'getUserAvailability'
        });
        
      default:
        throw new Error('Invalid action specified');
    }
  } catch (error) {
    console.error(`Error in availability management (${req.payload?.action}):`, error);
    return res.json({
      success: false,
      message: `Availability operation failed: ${error.message}`,
      error: error.message
    }, 500);
  }
};

// Helper function to check for matches
async function checkForMatches(databases, userId, classType, availabilities) {
  // For each availability, find if there are enough matching users
  for (const slot of availabilities) {
    const [day, time] = slot.split('-');
    
    // Find users available at this time
    const matches = await findMatchingUsers(databases, classType, day, time, userId);
    
    // If enough users (e.g., 3+), create a class
    if (matches.length >= 2) { // At least 3 total including current user
      // Prepare class creation payload
      const matchedUserIds = matches.map(m => m.userId);
      
      // Call class creation function via HTTP request
      // This would call your classManagement function with action=createClass
      // ...
    }
  }
}

async function findMatchingUsers(databases, classType, day, time, excludeUserId) {
  const timeSlot = `${day}-${time}`;
  
  // Find availabilities that include this time slot
  const matchingAvailabilities = await databases.listDocuments(
    process.env.DATABASE_ID,
    process.env.AVAILABILITY_COLLECTION_ID,
    [
      Query.equal('classType', classType),
      Query.equal('status', 'active'),
      Query.search('availabilities', timeSlot)
    ]
  );
  
  // Filter out excluded user
  return matchingAvailabilities.documents
    .filter(doc => doc.userId !== excludeUserId)
    .map(doc => ({
      userId: doc.userId,
      availabilityId: doc.$id
    }));
}