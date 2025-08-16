const { Client, Databases, Query, ID, Functions } = require('node-appwrite');

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

module.exports = async ({ req, res, log, error: logError }) => {
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
    const classTypesCollectionId = process.env.CLASS_TYPES_COLLECTION_ID;
    const notificationsFunctionId = process.env.NOTIFICATIONS_FUNCTION_ID || '68274a3f0031c188ee43';
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
    if (!classTypesCollectionId) {
        logError("Configuration Error: CLASS_TYPES_COLLECTION_ID environment variable not set.");
        throw new Error("CLASS_TYPES_COLLECTION_ID environment variable not set.");
    }

    client = new Client()
      .setEndpoint(appwriteEndpoint)
      .setProject(projectId)
      .setKey(apiKey);
    log("Appwrite client initialized successfully.");

    const databases = new Databases(client);
    const functions = new Functions(client);
    
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
        
        // Initialize the query array
        let classesQuery = [Query.equal('status', 'active')];
        
        // If classType is provided and not 'all', filter by it
        if (data.classType && data.classType !== 'all') {
          // Get all active class types
          const allClassTypes = await databases.listDocuments(
            databaseId,
            classTypesCollectionId,
            [Query.equal('isActive', true)]
          );
          
          // Filter class types that contain the category (JavaScript filtering)
          const matchingClassTypes = allClassTypes.documents.filter(ct => {
            const categories = (ct.category || '').split(',').map(cat => cat.trim());
            return categories.includes(data.classType);
          });
          
          if (matchingClassTypes.length > 0) {
            const classTypeIds = matchingClassTypes.map(ct => ct.$id);
            classesQuery.push(Query.equal('classTypeId', classTypeIds));
          } else {
            // No matching class types found, return empty array
            log(`No class types found for category: ${data.classType}`);
            return sendJsonResponse(res, 200, {
              success: true,
              classes: [],
              action: 'getAvailableClasses'
            }, log, logError);
          }
        }
        
        const classes = await databases.listDocuments(
          databaseId,
          classesCollectionId,
          classesQuery
        );
        
        // Enrich classes with class type information
        const enrichedClasses = await Promise.all(
          classes.documents.map(async (classDoc) => {
            try {
              const classType = await databases.getDocument(
                databaseId,
                classTypesCollectionId,
                classDoc.classTypeId
              );
              return {
                ...classDoc,
                classTypeName: classType.name,
                classTypeCategory: classType.category,
                type: classType.category || 'general' // For frontend compatibility
              };
            } catch (err) {
              logError(`Error fetching class type for class ${classDoc.$id}: ${err.message}`);
              return {
                ...classDoc,
                classTypeName: 'Unknown Class Type',
                classTypeCategory: 'general',
                type: 'general'
              };
            }
          })
        );
        
        log(`Found ${enrichedClasses.length} available classes.`);
        return sendJsonResponse(res, 200, {
          success: true,
          classes: enrichedClasses,
          action: 'getAvailableClasses'
        }, log, logError);

      case 'getAllClasses':
        log(`Executing action: getAllClasses for admin`);
        
        // Build query filters
        const queries = [];
        
        // Filter by class type category if specified
        if (data.classType && data.classType !== 'all') {
          const matchingClassTypes = await databases.listDocuments(
            databaseId,
            classTypesCollectionId,
            [Query.equal('category', data.classType)]
          );
          
          if (matchingClassTypes.documents.length > 0) {
            const classTypeIds = matchingClassTypes.documents.map(ct => ct.$id);
            queries.push(Query.equal('classTypeId', classTypeIds));
          }
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
        
        // Enrich classes with stats and class type info
        const classesWithStats = await Promise.all(
          allClasses.documents.map(async (classDoc) => {
            const totalSpots = classDoc.totalSpots || 0;
            const currentMembers = Array.isArray(classDoc.members) ? classDoc.members.length : 0;
            const spotsLeft = totalSpots - currentMembers;
            const fillRate = totalSpots > 0 ? (currentMembers / totalSpots) * 100 : 0;
            
            // Get class type info
            let classTypeName = 'Unknown Class Type';
            try {
              const classType = await databases.getDocument(
                databaseId,
                classTypesCollectionId,
                classDoc.classTypeId
              );
              classTypeName = classType.name;
            } catch (err) {
              logError(`Error fetching class type for class ${classDoc.$id}: ${err.message}`);
            }
            
            return {
              ...classDoc,
              currentMembers,
              spotsLeft,
              fillRate: Math.round(fillRate),
              classTypeName
            };
          })
        );
        
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
        
        // Enrich with class type info
        try {
          const classType = await databases.getDocument(
            databaseId,
            classTypesCollectionId,
            classDetails.classTypeId
          );
          classDetails.classTypeName = classType.name;
          classDetails.classTypeCategory = classType.category;
          classDetails.type = classType.category || 'general'; // For compatibility
        } catch (err) {
          logError(`Error fetching class type: ${err.message}`);
          classDetails.classTypeName = 'Unknown Class Type';
          classDetails.type = 'general';
        }
        
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
        const newMembersCount = updatedMembers.length;
        
        await databases.updateDocument(
          databaseId,
          classesCollectionId,
          data.classId,
          {
            members: updatedMembers,
            spotsLeft: (classDoc.totalSpots || 0) - newMembersCount
          }
        );
        
        log("User successfully joined class. Sending email notifications...");
        
        // Get class type for email
        let classTypeName = 'Class';
        try {
          const classType = await databases.getDocument(
            databaseId,
            classTypesCollectionId,
            classDoc.classTypeId
          );
          classTypeName = classType.name;
        } catch (err) {
          logError(`Error fetching class type for notification: ${err.message}`);
        }
        
        // Send email notifications
        try {
          const emailData = {
            action: 'sendClassJoinConfirmation',
            userName: data.name,
            userEmail: data.email,
            userPhone: data.phone,
            classType: classTypeName,
            day: classDoc.day,
            time: classDoc.time,
            currentEnrollment: newMembersCount,
            totalSpots: classDoc.totalSpots || 0
          };
          
          log(`Calling notifications function with data: ${JSON.stringify(emailData)}`);
          
          const emailExecution = await functions.createExecution(
            notificationsFunctionId,
            JSON.stringify(emailData)
          );
          
          log(`Email notifications execution status: ${emailExecution.status}`);
          if (emailExecution.status === 'failed') {
            logError(`Email notifications failed: ${emailExecution.stderr}`);
          }
        } catch (emailError) {
          logError(`Error sending email notifications: ${emailError.message}`);
          // Don't fail the join operation if emails fail
        }
        
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
        if (data.classTypeId) updateData.classTypeId = data.classTypeId;
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

        if (!data.classTypeId) {
            throw new Error("classTypeId is required for creating a class.");
        }

        // Verify the class type exists
        try {
          await databases.getDocument(
            databaseId,
            classTypesCollectionId,
            data.classTypeId
          );
        } catch (err) {
          throw new Error("Invalid classTypeId: Class type not found.");
        }

        const newClass = await databases.createDocument(
          databaseId,
          classesCollectionId,
          ID.unique(),
          {
            classTypeId: data.classTypeId,
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

      // Class type management actions
      case 'getClassTypes':
        log(`Executing action: getClassTypes`);
        const classTypes = await databases.listDocuments(
          databaseId,
          classTypesCollectionId,
          [
            Query.equal('isActive', true),
            Query.orderAsc('name')
          ]
        );
        log(`Found ${classTypes.documents.length} active class types.`);
        return sendJsonResponse(res, 200, {
          success: true,
          classTypes: classTypes.documents,
          action: 'getClassTypes'
        }, log, logError);

      case 'getAllClassTypes':
        log(`Executing action: getAllClassTypes for admin`);
        const allClassTypes = await databases.listDocuments(
          databaseId,
          classTypesCollectionId,
          [Query.orderAsc('name')]
        );
        
        // Add usage count to each class type
        const classTypesWithUsage = await Promise.all(
          allClassTypes.documents.map(async (classType) => {
            const usageCount = await databases.listDocuments(
              databaseId,
              classesCollectionId,
              [Query.equal('classTypeId', classType.$id)]
            );
            return {
              ...classType,
              usageCount: usageCount.total
            };
          })
        );
        
        log(`Found ${allClassTypes.documents.length} class types for admin view.`);
        return sendJsonResponse(res, 200, {
          success: true,
          classTypes: classTypesWithUsage,
          action: 'getAllClassTypes'
        }, log, logError);

      case 'createClassType':
        log(`Executing action: createClassType with data: ${JSON.stringify(data)}`);
        const newClassType = await databases.createDocument(
          databaseId,
          classTypesCollectionId,
          ID.unique(),
          {
            name: data.name,
            category: data.category || '',
            description: data.description || '',
            isActive: true
          }
        );
        log(`New class type created with ID: ${newClassType.$id}`);
        return sendJsonResponse(res, 201, {
          success: true,
          classType: newClassType,
          action: 'createClassType'
        }, log, logError);

      case 'updateClassType':
        log(`Executing action: updateClassType for classTypeId: ${data.classTypeId}`);
        const updateClassTypeData = {};
        if (data.name) updateClassTypeData.name = data.name;
        if (data.category !== undefined) updateClassTypeData.category = data.category;
        if (data.description !== undefined) updateClassTypeData.description = data.description;
        if (data.isActive !== undefined) updateClassTypeData.isActive = data.isActive;
        
        const updatedClassType = await databases.updateDocument(
          databaseId,
          classTypesCollectionId,
          data.classTypeId,
          updateClassTypeData
        );
        
        log(`Class type ${data.classTypeId} updated successfully`);
        return sendJsonResponse(res, 200, {
          success: true,
          classType: updatedClassType,
          action: 'updateClassType'
        }, log, logError);

      case 'deleteClassType':
        log(`Executing action: deleteClassType for classTypeId: ${data.classTypeId}`);
        
        // Check if any classes are using this class type
        const classesUsingType = await databases.listDocuments(
          databaseId,
          classesCollectionId,
          [Query.equal('classTypeId', data.classTypeId)]
        );
        
        if (classesUsingType.total > 0) {
          log(`Cannot delete class type ${data.classTypeId}: ${classesUsingType.total} classes are using it`);
          return sendJsonResponse(res, 400, {
            success: false,
            message: `Cannot delete class type. ${classesUsingType.total} classes are still using it.`,
            action: 'deleteClassType'
          }, log, logError);
        }
        
        await databases.deleteDocument(
          databaseId,
          classTypesCollectionId,
          data.classTypeId
        );
        
        log(`Class type ${data.classTypeId} deleted successfully`);
        return sendJsonResponse(res, 200, {
          success: true,
          message: 'Class type deleted successfully',
          action: 'deleteClassType'
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