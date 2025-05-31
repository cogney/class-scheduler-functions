import { Client, Account, Users } from 'node-appwrite';

// Helper function to log and send JSON response
const sendJsonResponse = (res, statusCode, data, log, logError) => {
  const responseLogMessage = `Sending response: Status ${statusCode}, Data: ${JSON.stringify(data)}`;
  if (statusCode >= 400) {
    logError ? logError(responseLogMessage) : console.error(responseLogMessage);
  } else {
    log ? log(responseLogMessage) : console.log(responseLogMessage);
  }
  return res.json(data);
};

export default async ({ req, res, log, error: logError }) => {
  log("userAuth function invoked.");
  log(`Request Method: ${req.method}`);
  log(`Request Headers: ${JSON.stringify(req.headers)}`);
  log(`Raw Request Body (req.body): ${req.body}`);

  try {
    // --- Client Initialization ---
    log("Attempting to initialize Appwrite client...");
    const projectId = process.env.APPWRITE_FUNCTION_PROJECT_ID;
    const apiKey = process.env.APPWRITE_API_KEY;
    const appwriteEndpoint = process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';

    if (!projectId) {
      logError("Configuration Error: APPWRITE_FUNCTION_PROJECT_ID environment variable not set.");
      throw new Error("APPWRITE_FUNCTION_PROJECT_ID environment variable not set.");
    }
    if (!apiKey) {
      logError("Configuration Error: APPWRITE_API_KEY environment variable not set.");
      throw new Error("APPWRITE_API_KEY environment variable not set.");
    }

    const client = new Client()
      .setEndpoint(appwriteEndpoint)
      .setProject(projectId)
      .setKey(apiKey);
    log("Appwrite client initialized successfully.");

    const users = new Users(client);
    const account = new Account(client);
    
    // --- Payload Parsing ---
    log("Attempting to parse request body...");
    const requestBodyString = req.body || '{}';
    const parsedPayload = JSON.parse(requestBodyString);
    const { action, ...data } = parsedPayload;
    log(`Parsed Action: ${action}`);
    log(`Parsed Data: ${JSON.stringify(data)}`);

    if (!action) {
      logError("No action specified in the payload.");
      return sendJsonResponse(res, 400, {
        success: false,
        message: 'Invalid action: No action specified.',
        action: 'unknown'
      }, log, logError);
    }
    
    switch (action) {
      case 'register':
        log(`Executing action: register for email: ${data.email}`);
        // Register new user
        const newUser = await users.create(
          'unique()', 
          data.email,
          data.password,
          data.name
        );
        
        // Add phone to preferences
        await users.updatePrefs(newUser.$id, { phone: data.phone });
        
        log(`User registered successfully with ID: ${newUser.$id}`);
        return sendJsonResponse(res, 200, {
          success: true,
          userId: newUser.$id,
          action: 'register'
        }, log, logError);
        
      case 'getProfile':
        log(`Executing action: getProfile for userId: ${data.userId}`);
        // Get user profile data
        const user = await users.get(data.userId);
        const prefs = await users.getPrefs(data.userId);
        
        log("User profile fetched successfully.");
        return sendJsonResponse(res, 200, {
          success: true,
          user: {
            id: user.$id,
            name: user.name,
            email: user.email,
            phone: prefs.phone
          },
          action: 'getProfile'
        }, log, logError);

      case 'verifyAdmin':
        log(`Executing action: verifyAdmin for userId: ${data.userId}`);
        // Check if user has admin label
        const adminUser = await users.get(data.userId);
        const isAdmin = adminUser.labels && adminUser.labels.includes('admin');
        
        log(`Admin verification result for user ${data.userId}: ${isAdmin}`);
        return sendJsonResponse(res, 200, {
          success: true,
          isAdmin: isAdmin,
          userId: data.userId,
          action: 'verifyAdmin'
        }, log, logError);

      case 'getUsersByClass':
        log(`Executing action: getUsersByClass for ${data.members?.length || 0} members`);
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
                  logError(`Error fetching user details for ${member.userId}: ${userError.message}`);
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
              logError(`Error parsing member: ${parseError.message}`);
            }
          }
        }
        
        log(`Successfully processed ${memberDetails.length} member details`);
        return sendJsonResponse(res, 200, {
          success: true,
          members: memberDetails,
          totalMembers: memberDetails.length,
          action: 'getUsersByClass'
        }, log, logError);
        
      default:
        log(`Warning: Invalid action received: ${action}`);
        return sendJsonResponse(res, 400, {
          success: false,
          message: 'Invalid action specified',
          action: action || 'unknown'
        }, log, logError);
    }
  } catch (error) {
    logError("An error occurred in userAuth function execution:");
    logError(`Error Message: ${error.message}`);
    logError(`Error Stack: ${error.stack}`);
    if (error.response) {
      logError(`Appwrite SDK Error Response: ${JSON.stringify(error.response)}`);
    }
    
    return sendJsonResponse(res, 500, {
      success: false,
      message: `User auth operation failed: ${error.message}`,
      errorDetails: error.toString()
    }, log, logError);
  }
};