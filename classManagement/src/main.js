import { Client, Databases, Query, ID } from 'node-appwrite';

// Helper function to log and send JSON response
// We'll pass log and logError to it
const sendJsonResponse = (res, statusCode, data, log, logError) => {
  const responseLogMessage = `Sending response: Status ${statusCode}, Data: ${JSON.stringify(data)}`;
  if (statusCode >= 400) {
    logError ? logError(responseLogMessage) : console.error(responseLogMessage); // Use logError if available
  } else {
    log ? log(responseLogMessage) : console.log(responseLogMessage); // Use log if available
  }
  // Appwrite's res.json typically only takes data. Status code is often implicit or set via res.status().
  // For simplicity and common Appwrite practice, we'll use res.json(data).
  // If you need to set a specific status code and res.json doesn't take it,
  // you might need to use res.status(statusCode).json(data) if supported, or res.send(JSON.stringify(data), statusCode).
  // However, Appwrite often infers success/failure status.
  return res.json(data);
};


export default async ({ req, res, log, error: logError }) => { // Use log and error (aliased to logError) from context
  log("classManagement function invoked.");
  log(`Request Method: ${req.method}`);
  log(`Request Headers: ${JSON.stringify(req.headers)}`);
  log(`Raw Request Body (req.body): ${req.body}`); // THIS IS KEY FOR DEBUGGING PAYLOAD

  let client;

  try {
    // --- Client Initialization ---
    log("Attempting to initialize Appwrite client...");
    const projectId = process.env.APPWRITE_FUNCTION_PROJECT_ID;
    const apiKey = process.env.APPWRITE_API_KEY;
    const databaseId = process.env.DATABASE_ID;
    const classesCollectionId = process.env.CLASSES_COLLECTION_ID;
    const appwriteEndpoint = process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';


    if (!projectId) {
        logError("Configuration Error: APPWRITE_FUNCTION_PROJECT_ID environment variable not set.");
        // No return here yet, let it fall into the main catch which will use sendJsonResponse
        throw new Error("APPWRITE_FUNCTION_PROJECT_ID environment variable not set.");
    }
    if (!apiKey) {
        logError("Configuration Error: APPWRITE_API_KEY environment variable not set.");
        throw new Error("APPWRITE_API_KEY environment variable not set.");
    }
    if (!databaseId) {
        logError("Configuration Error: DATABASE_ID environment variable not set.");
        throw new Error("DATABASE_ID environment variable not set.");
    }
    if (!classesCollectionId) {
        logError("Configuration Error: CLASSES_COLLECTION_ID environment variable not set.");
        throw new Error("CLASSES_COLLECTION_ID environment variable not set.");
    }

    client = new Client()
      .setEndpoint(appwriteEndpoint)
      .setProject(projectId)
      .setKey(apiKey);
    log("Appwrite client initialized successfully.");

    const databases = new Databases(client);
    
    // --- Payload Parsing ---
    log("Attempting to parse request body...");
    const requestBodyString = req.body || '{}';
    if (requestBodyString === '{}' && req.body && req.body.length > 0) { // Check if req.body was not an empty string initially
        log(`Warning: req.body was present but perhaps not valid JSON, resulting in empty object. Original req.body type: ${typeof req.body}, content: ${req.body.substring(0,100)}...`);
    }
    const parsedPayload = JSON.parse(requestBodyString); // This can throw if req.body is not valid JSON
    const { action, ...data } = parsedPayload;
    log(`Parsed Action: ${action}`);
    log(`Parsed Data: ${JSON.stringify(data)}`);

    if (!action) {
      logError("No action specified in the payload.");
      return sendJsonResponse(res, 400, { // Using helper
        success: false,
        message: 'Invalid action: No action specified.',
        action: 'unknown'
      }, log, logError);
    }
    
    switch (action) {
      case 'getAvailableClasses':
        log(`Executing action: getAvailableClasses with type: ${data.classType}`);
        const classes = await databases.listDocuments(
          databaseId,
          classesCollectionId,
          [
            Query.equal('type', data.classType),
            Query.equal('status', 'active'), // Ensure 'status' is queryable
          ]
        );
        log(`Found ${classes.documents.length} available classes.`);
        return sendJsonResponse(res, 200, {
          success: true,
          classes: classes.documents,
          action: 'getAvailableClasses'
        }, log, logError);
        
      case 'getClassDetails':
        log(`Executing action: getClassDetails for classId: ${data.classId}`);
        const classDetails = await databases.getDocument(
          databaseId,
          classesCollectionId,
          data.classId
        );
        log("Class details fetched successfully.");
        return sendJsonResponse(res, 200, {
          success: true,
          class: classDetails,
          action: 'getClassDetails'
        }, log, logError);
        
      case 'joinClass':
        log(`Executing action: joinClass for classId: ${data.classId}, userId: ${data.userId}`);
        const classDoc = await databases.getDocument(
          databaseId,
          classesCollectionId,
          data.classId
        );
        
        log(`Class to join: ${classDoc.$id}, Members: ${classDoc.members?.length || 0}, Total Spots: ${classDoc.totalSpots}`);
        // Ensure members and totalSpots are numbers for comparison
        const currentMembersCount = classDoc.members?.length || 0;
        const totalSpots = typeof classDoc.totalSpots === 'number' ? classDoc.totalSpots : 0;

        if (currentMembersCount >= totalSpots) {
          log(`Warning: Class is full. Members: ${currentMembersCount}, Spots: ${totalSpots}`);
          return sendJsonResponse(res, 400, {
            success: false,
            message: 'Class is full',
            action: 'joinClass'
          }, log, logError);
        }
        
        const existingMembers = Array.isArray(classDoc.members) ? classDoc.members : [];
        const updatedMembers = [...existingMembers, { 
          userId: data.userId, 
          name: data.name 
        }];
        
        await databases.updateDocument(
          databaseId,
          classesCollectionId,
          data.classId,
          {
            members: updatedMembers,
            spotsLeft: totalSpots - updatedMembers.length
          }
        );
        log("User successfully joined class.");
        return sendJsonResponse(res, 200, {
          success: true,
          message: 'Successfully joined class',
          action: 'joinClass'
        }, log, logError);
        
      case 'createClass':
        log(`Executing action: createClass with data: ${JSON.stringify(data)}`);
        const spots = data.totalSpots || 5; // Default to 5 if not provided
        const initialMembersCount = data.initialMembers?.length || 0;

        if (typeof data.classType !== 'string' || !data.classType) {
            throw new Error("classType is required and must be a string for creating a class.");
        }
        // Add more validations for required fields like day, time as needed

        const newClass = await databases.createDocument(
          databaseId,
          classesCollectionId,
          ID.unique(),
          {
            type: data.classType,
            day: data.day, // Ensure these are validated or have defaults
            time: data.time, // Ensure these are validated or have defaults
            members: data.initialMembers || [],
            totalSpots: spots,
            spotsLeft: spots - initialMembersCount,
            status: 'active',
            createdAt: new Date().toISOString()
          }
        );
        log(`New class created with ID: ${newClass.$id}`);
        // For 'create' operations, a 201 status code is more appropriate.
        // However, sendJsonResponse currently defaults to 200 implicitly with res.json.
        // If Appwrite's res object allows res.status(201).json(...), that would be ideal.
        // For now, keeping it simple.
        return sendJsonResponse(res, 201, { // Pass 201, but actual setting depends on res.json behavior
          success: true,
          classId: newClass.$id,
          action: 'createClass'
        }, log, logError);
      
      default:
        log(`Warning: Invalid action received: ${action}`);
        return sendJsonResponse(res, 400, {
          success: false,
          message: 'Invalid action specified',
          action: action || 'unknown'
        }, log, logError);
    }
  } catch (e) { // Changed error variable to 'e' to avoid conflict with context 'error'
    logError("An error occurred in classManagement function execution:");
    logError(`Error Message: ${e.message}`);
    logError(`Error Stack: ${e.stack}`);
    if (e.response) { // If it's an Appwrite SDK error, it might have more details
        logError(`Appwrite SDK Error Response: ${JSON.stringify(e.response)}`);
    }
    
    // The res.json() in Appwrite usually implies a 200 OK for success or a different status
    // if the function execution itself fails (which Appwrite handles as a 500).
    // To explicitly send a 500 from our logic, we'd need a res.send() or res.status().json().
    // For now, we send a success:false payload.
    return sendJsonResponse(res, 500, {
      success: false,
      message: `Class operation failed: ${e.message}`,
      errorDetails: e.toString()
    }, log, logError);
  }
}