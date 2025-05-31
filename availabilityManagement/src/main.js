const { Client, Databases, Query, ID } = require('node-appwrite');

// Helper function to log and send JSON response
const sendJsonResponse = (res, statusCode, data) => {
  const responseLogMessage = `Sending response: Status ${statusCode}, Data: ${JSON.stringify(data)}`;
  if (statusCode >= 400) {
    console.error(responseLogMessage);
  } else {
    console.log(responseLogMessage);
  }
  return res.json(data);
};

module.exports = async function(req, res) {
  console.log("availabilityManagement function invoked.");
  console.log(`Request Method: ${req.method}`);
  console.log(`Request Headers: ${JSON.stringify(req.headers)}`);
  console.log(`Raw Request Body (req.body): ${req.body}`);

  let client;

  try {
    // --- Client Initialization ---
    console.log("Attempting to initialize Appwrite client...");
    const projectId = process.env.APPWRITE_FUNCTION_PROJECT_ID;
    const apiKey = process.env.APPWRITE_API_KEY;
    const databaseId = process.env.DATABASE_ID;
    const availabilityCollectionId = process.env.AVAILABILITY_COLLECTION_ID;
    const classesCollectionId = process.env.CLASSES_COLLECTION_ID;
    const appwriteEndpoint = process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';

    if (!projectId) {
      console.error("Configuration Error: APPWRITE_FUNCTION_PROJECT_ID environment variable not set.");
      throw new Error("APPWRITE_FUNCTION_PROJECT_ID environment variable not set.");
    }
    if (!apiKey) {
      console.error("Configuration Error: APPWRITE_API_KEY environment variable not set.");
      throw new Error("APPWRITE_API_KEY environment variable not set.");
    }
    if (!databaseId) {
      console.error("Configuration Error: DATABASE_ID environment variable not set.");
      throw new Error("DATABASE_ID environment variable not set.");
    }
    if (!availabilityCollectionId) {
      console.error("Configuration Error: AVAILABILITY_COLLECTION_ID environment variable not set.");
      throw new Error("AVAILABILITY_COLLECTION_ID environment variable not set.");
    }

    client = new Client()
      .setEndpoint(appwriteEndpoint)
      .setProject(projectId)
      .setKey(apiKey);
    console.log("Appwrite client initialized successfully.");

    const databases = new Databases(client);
    
    // --- Payload Parsing ---
    console.log("Attempting to parse request body...");
    const requestBodyString = req.body || '{}';
    const parsedPayload = JSON.parse(requestBodyString);
    const { action, ...data } = parsedPayload;
    console.log(`Parsed Action: ${action}`);
    console.log(`Parsed Data: ${JSON.stringify(data)}`);

    if (!action) {
      console.error("No action specified in the payload.");
      return sendJsonResponse(res, 400, {
        success: false,
        message: 'Invalid action: No action specified.',
        action: 'unknown'
      });
    }
    
    switch (action) {
      case 'submitAvailability':
        console.log(`Executing action: submitAvailability for userId: ${data.userId}, classType: ${data.classType}`);
        console.log(`Availabilities: ${JSON.stringify(data.availabilities)}`);
        
        // Save user's availability
        const availabilityDoc = await databases.createDocument(
          databaseId,
          availabilityCollectionId,
          ID.unique(),
          {
            userId: data.userId,
            classType: data.classType,
            availabilities: data.availabilities,
            status: 'active',
            createdAt: new Date().toISOString()
          }
        );
        
        console.log(`Availability document created with ID: ${availabilityDoc.$id}`);
        
        // Optionally trigger match checking
        if (data.checkForMatches) {
          console.log("Checking for matches...");
          await checkForMatches(databases, data.userId, data.classType, data.availabilities, databaseId, availabilityCollectionId, classesCollectionId);
        }
        
        return sendJsonResponse(res, 200, {
          success: true,
          availabilityId: availabilityDoc.$id,
          action: 'submitAvailability'
        });
        
      case 'findMatches':
        console.log(`Executing action: findMatches for classType: ${data.classType}, day: ${data.day}, time: ${data.time}`);
        
        // Find matching availabilities for a time slot
        const matches = await findMatchingUsers(
          databases, 
          data.classType, 
          data.day, 
          data.time, 
          data.excludeUserId,
          databaseId,
          availabilityCollectionId
        );
        
        return sendJsonResponse(res, 200, {
          success: true,
          matches: matches,
          action: 'findMatches'
        });
        
      case 'getUserAvailability':
        console.log(`Executing action: getUserAvailability for userId: ${data.userId}`);
        
        // Get a user's availability
        const userAvailability = await databases.listDocuments(
          databaseId,
          availabilityCollectionId,
          [
            Query.equal('userId', data.userId),
            Query.equal('status', 'active')
          ]
        );
        
        console.log(`Found ${userAvailability.documents.length} availability documents for user.`);
        
        return sendJsonResponse(res, 200, {
          success: true,
          availabilities: userAvailability.documents,
          action: 'getUserAvailability'
        });
        
      default:
        console.log(`Warning: Invalid action received: ${action}`);
        return sendJsonResponse(res, 400, {
          success: false,
          message: 'Invalid action specified',
          action: action || 'unknown'
        });
    }
  } catch (e) {
    console.error("An error occurred in availabilityManagement function execution:");
    console.error(`Error Message: ${e.message}`);
    console.error(`Error Stack: ${e.stack}`);
    if (e.response) {
      console.error(`Appwrite SDK Error Response: ${JSON.stringify(e.response)}`);
    }
    
    return sendJsonResponse(res, 500, {
      success: false,
      message: `Availability operation failed: ${e.message}`,
      errorDetails: e.toString()
    });
  }
};

// Helper function to check for matches
async function checkForMatches(databases, userId, classType, availabilities, databaseId, availabilityCollectionId, classesCollectionId) {
  console.log("Starting match checking process...");
  
  // For each availability, find if there are enough matching users
  for (const slot of availabilities) {
    console.log(`Checking matches for slot: ${slot}`);
    const [day, time] = slot.split('-');
    
    if (!day || !time) {
      console.log(`Warning: Invalid slot format: ${slot}`);
      continue;
    }
    
    try {
      // Find users available at this time
      const matches = await findMatchingUsers(databases, classType, day, time, userId, databaseId, availabilityCollectionId);
      
      console.log(`Found ${matches.length} matching users for ${slot}`);
      
      // If enough users (e.g., 3+), create a class
      if (matches.length >= 2) { // At least 3 total including current user
        console.log(`Enough matches found for ${slot}. Creating class...`);
        
        // Here you could call your classManagement function to create a class
        // For now, just log the potential class creation
        console.log(`Would create class: ${classType} on ${day} at ${time} with users: ${userId}, ${matches.map(m => m.userId).join(', ')}`);
        
        // TODO: Implement class creation logic
        // This could involve calling the classManagement function or creating the class directly here
      }
    } catch (error) {
      console.error(`Error checking matches for slot ${slot}: ${error.message}`);
    }
  }
}

async function findMatchingUsers(databases, classType, day, time, excludeUserId, databaseId, availabilityCollectionId) {
  const timeSlot = `${day}-${time}`;
  console.log(`Looking for users with availability for: ${timeSlot}`);
  
  try {
    // Find availabilities that include this time slot
    const matchingAvailabilities = await databases.listDocuments(
      databaseId,
      availabilityCollectionId,
      [
        Query.equal('classType', classType),
        Query.equal('status', 'active'),
        // Note: Query.search might not work as expected with arrays
        // You might need to use Query.contains if available, or filter in code
      ]
    );
    
    console.log(`Found ${matchingAvailabilities.documents.length} total availability documents`);
    
    // Filter documents that contain the time slot and exclude the current user
    const matches = matchingAvailabilities.documents
      .filter(doc => {
        // Check if this document includes the time slot
        const hasTimeSlot = doc.availabilities && doc.availabilities.includes(timeSlot);
        // Exclude the current user
        const isNotCurrentUser = doc.userId !== excludeUserId;
        
        return hasTimeSlot && isNotCurrentUser;
      })
      .map(doc => ({
        userId: doc.userId,
        availabilityId: doc.$id
      }));
    
    console.log(`Filtered to ${matches.length} matching users`);
    return matches;
  } catch (error) {
    console.log(`Error finding matching users: ${error.message}`);
    throw error;
  }
}