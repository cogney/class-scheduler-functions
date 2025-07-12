import { Client, Databases, Query, ID } from 'node-appwrite';

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
  log("classManagement function invoked.");
  log(`Request Method: ${req.method}`);
  log(`Request Headers: ${JSON.stringify(req.headers)}`);
  log(`Raw Request Body (req.body): ${req.body}`);

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
      case 'getAvailableClasses':
        log(`Executing action: getAvailableClasses with type: ${data.classType}`);
        const classes = await databases.listDocuments(
          databaseId,
          classesCollectionId,
          [
            Query.equal('type', data.classType),
            Query.equal('status', 'active'),
          ]
        );
        log(`Found ${classes.documents.length} available classes.`);
        return sendJsonResponse(res, 200, {
          success: true,
          classes: classes.documents,
          action: 'getAvailableClasses'
        }, log, logError);

      case 'getAllClasses':
        log(`Executing action: getAllClasses for admin`);
        
        // Build query filters
        const queries = [];
        
        // Filter by class type if specified
        if (data.classType && data.classType !== 'all') {
          queries.push(Query.equal('type', data.classType));
        }
        
        // Filter by status if specified
        if (data.status && data.status !== 'all') {
          queries.push(Query.equal('status', data.status));
        }
        
        // Add pagination
        const limit = data.limit || 25;
        const offset = data.offset || 0;
        queries.push(Query.limit(limit));
        queries.push(Query.offset(offset));
        
        // Order by creation date (newest first)
        queries.push(Query.orderDesc('$createdAt'));
        
        const allClasses = await databases.listDocuments(
          databaseId,
          classesCollectionId,
          queries
        );
        
        // Calculate enrollment info for each class
        const classesWithStats = allClasses.documents.map(classDoc => {
          const totalSpots = classDoc.totalSpots || 0;
          const currentMembers = Array.isArray(classDoc.members) ? classDoc.members.length : 0;
          const spotsLeft = totalSpots - currentMembers;
          const fillRate = totalSpots > 0 ? (currentMembers / totalSpots) * 100 : 0;
          
          return {
            ...classDoc,
            currentMembers,
            spotsLeft,
            fillRate: Math.round(fillRate)
          };
        });
        
        log(`Found ${allClasses.documents.length} classes for admin view.`);
        return sendJsonResponse(res, 200, {
          success: true,
          classes: classesWithStats,
          total: allClasses.total,
          action: 'getAllClasses'
        }, log, logError);

      case 'getClassStats':
        log(`Executing action: getClassStats for admin dashboard`);
        
        // Get all classes for stats calculation
        const statsClasses = await databases.listDocuments(
          databaseId,
          classesCollectionId,
          [Query.limit(1000)] // Get all classes
        );
        
        const totalClasses = statsClasses.documents.length;
        const activeClasses = statsClasses.documents.filter(c => c.status === 'active').length;
        
        // Calculate total enrolled students and fill rate
        let totalEnrolled = 0;
        let totalSpots = 0;
        
        statsClasses.documents.forEach(classDoc => {
          const currentMembers = Array.isArray(classDoc.members) ? classDoc.members.length : 0;
          const spots = classDoc.totalSpots || 0;
          
          totalEnrolled += currentMembers;
          totalSpots += spots;
        });
        
        const overallFillRate = totalSpots > 0 ? Math.round((totalEnrolled / totalSpots) * 100) : 0;
        
        const stats = {
          totalClasses,
          activeClasses,
          enrolledStudents: totalEnrolled,
          fillRate: overallFillRate,
          totalCapacity: totalSpots
        };
        
        log(`Generated stats: ${JSON.stringify(stats)}`);
        return sendJsonResponse(res, 200, {
          success: true,
          stats,
          action: 'getClassStats'
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
        const currentMembersCount = classDoc.members?.length || 0;

        if (currentMembersCount >= (classDoc.totalSpots || 0)) {
          log(`Warning: Class is full. Members: ${currentMembersCount}, Spots: ${classDoc.totalSpots || 0}`);
          return sendJsonResponse(res, 400, {
            success: false,
            message: 'Class is full',
            action: 'joinClass'
          }, log, logError);
        }
        
        // Check if user is already in the class
        const existingMembers = Array.isArray(classDoc.members) ? classDoc.members : [];
        const userAlreadyJoined = existingMembers.some(memberStr => {
          try {
            const member = JSON.parse(memberStr);
            return member.userId === data.userId;
          } catch (e) {
            return false;
          }
        });

        if (userAlreadyJoined) {
          log(`Warning: User ${data.userId} already joined this class.`);
          return sendJsonResponse(res, 400, {
            success: false,
            message: 'You have already joined this class',
            action: 'joinClass'
          }, log, logError);
        }
        
        // Create member object with join timestamp
        const newMember = { 
          userId: data.userId, 
          name: data.name,
          joinedAt: new Date().toISOString()
        };
        
        const memberString = JSON.stringify(newMember);
        log(`Adding member string: ${memberString}`);
        
        const updatedMembers = [...existingMembers, memberString];
        
        await databases.updateDocument(
          databaseId,
          classesCollectionId,
          data.classId,
          {
            members: updatedMembers,
            spotsLeft: (classDoc.totalSpots || 0) - updatedMembers.length
          }
        );
        log("User successfully joined class.");
        return sendJsonResponse(res, 200, {
          success: true,
          message: 'Successfully joined class',
          action: 'joinClass'
        }, log, logError);

      case 'leaveClass':
        log(`Executing action: leaveClass for classId: ${data.classId}, userId: ${data.userId}`);
        const classToLeave = await databases.getDocument(
          databaseId,
          classesCollectionId,
          data.classId
        );
        
        log(`Class to leave: ${classToLeave.$id}, Members: ${classToLeave.members?.length || 0}`);
        
        const currentMembers = Array.isArray(classToLeave.members) ? classToLeave.members : [];
        
        // Find and remove the user from members array
        const updatedMembersAfterLeave = currentMembers.filter(memberStr => {
          try {
            const member = JSON.parse(memberStr);
            return member.userId !== data.userId;
          } catch (e) {
            return true;
          }
        });
        
        // Check if user was actually in the class
        if (updatedMembersAfterLeave.length === currentMembers.length) {
          log(`Warning: User ${data.userId} was not found in class ${data.classId}`);
          return sendJsonResponse(res, 400, {
            success: false,
            message: 'You are not enrolled in this class',
            action: 'leaveClass'
          }, log, logError);
        }
        
        // Update the class document
        await databases.updateDocument(
          databaseId,
          classesCollectionId,
          data.classId,
          {
            members: updatedMembersAfterLeave,
            spotsLeft: (classToLeave.totalSpots || 0) - updatedMembersAfterLeave.length
          }
        );
        
        log(`User successfully left class. Remaining members: ${updatedMembersAfterLeave.length}`);
        return sendJsonResponse(res, 200, {
          success: true,
          message: 'Successfully left class',
          action: 'leaveClass'
        }, log, logError);

      case 'updateClass':
        log(`Executing action: updateClass for classId: ${data.classId}`);
        
        // Build update object
        const updateData = {};
        
        if (data.day) updateData.day = data.day;
        if (data.time) updateData.time = data.time;
        if (data.type) updateData.type = data.type;
        if (data.totalSpots !== undefined) {
          updateData.totalSpots = data.totalSpots;
          // Recalculate spots left
          const currentClass = await databases.getDocument(databaseId, classesCollectionId, data.classId);
          const currentMembersCount = Array.isArray(currentClass.members) ? currentClass.members.length : 0;
          updateData.spotsLeft = data.totalSpots - currentMembersCount;
        }
        
        const updatedClass = await databases.updateDocument(
          databaseId,
          classesCollectionId,
          data.classId,
          updateData
        );
        
        log(`Class ${data.classId} updated successfully`);
        return sendJsonResponse(res, 200, {
          success: true,
          class: updatedClass,
          action: 'updateClass'
        }, log, logError);

      case 'cancelClass':
        log(`Executing action: cancelClass for classId: ${data.classId}`);
        
        const cancelledClass = await databases.updateDocument(
          databaseId,
          classesCollectionId,
          data.classId,
          {
            status: 'cancelled',
            cancelledAt: new Date().toISOString(),
            cancelReason: data.reason || 'No reason provided'
          }
        );
        
        log(`Class ${data.classId} cancelled successfully`);
        return sendJsonResponse(res, 200, {
          success: true,
          class: cancelledClass,
          action: 'cancelClass'
        }, log, logError);

      case 'reactivateClass':
        log(`Executing action: reactivateClass for classId: ${data.classId}`);
        
        const reactivatedClass = await databases.updateDocument(
          databaseId,
          classesCollectionId,
          data.classId,
          {
            status: 'active',
            reactivatedAt: new Date().toISOString()
          }
        );
        
        log(`Class ${data.classId} reactivated successfully`);
        return sendJsonResponse(res, 200, {
          success: true,
          class: reactivatedClass,
          action: 'reactivateClass'
        }, log, logError);

      case 'deleteClass':
        log(`Executing action: deleteClass for classId: ${data.classId}`);
        
        await databases.deleteDocument(
          databaseId,
          classesCollectionId,
          data.classId
        );
        
        log(`Class ${data.classId} deleted successfully`);
        return sendJsonResponse(res, 200, {
          success: true,
          message: 'Class deleted successfully',
          action: 'deleteClass'
        }, log, logError);
        
      case 'createClass':
        log(`Executing action: createClass with data: ${JSON.stringify(data)}`);
        const spots = data.totalSpots || 5;
        const initialMembersCount = data.initialMembers?.length || 0;

        if (typeof data.classType !== 'string' || !data.classType) {
            throw new Error("classType is required and must be a string for creating a class.");
        }

        const newClass = await databases.createDocument(
          databaseId,
          classesCollectionId,
          ID.unique(),
          {
            type: data.classType,
            day: data.day,
            time: data.time,
            members: data.initialMembers || [],
            totalSpots: spots,
            spotsLeft: spots - initialMembersCount,
            status: 'active',
          }
        );
        log(`New class created with ID: ${newClass.$id}`);
        return sendJsonResponse(res, 201, {
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
  } catch (e) {
    logError("An error occurred in classManagement function execution:");
    logError(`Error Message: ${e.message}`);
    logError(`Error Stack: ${e.stack}`);
    if (e.response) {
        logError(`Appwrite SDK Error Response: ${JSON.stringify(e.response)}`);
    }
    
    return sendJsonResponse(res, 500, {
      success: false,
      message: `Class operation failed: ${e.message}`,
      errorDetails: e.toString()
    }, log, logError);
  }
};