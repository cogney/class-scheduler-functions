// classManagement.js - handles all class-related operations
import { Client, Databases, Query, ID } from 'node-appwrite';

module.exports = async function(req, res) {
  const client = new Client()
    .setEndpoint('https://fra.appwrite.io/v1')
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const databases = new Databases(client);
  
  try {
    const { action, ...data } = JSON.parse(req.payload || '{}');
    
    switch (action) {
      case 'getAvailableClasses':
        // Get available classes by type
        const classes = await databases.listDocuments(
          process.env.DATABASE_ID,
          process.env.CLASSES_COLLECTION_ID,
          [
            Query.equal('type', data.classType),
            Query.equal('status', 'active'),
          ]
        );
        
        return res.json({
          success: true,
          classes: classes.documents,
          action: 'getAvailableClasses'
        });
        
      case 'getClassDetails':
        // Get details for a specific class
        const classDetails = await databases.getDocument(
          process.env.DATABASE_ID,
          process.env.CLASSES_COLLECTION_ID,
          data.classId
        );
        
        return res.json({
          success: true,
          class: classDetails,
          action: 'getClassDetails'
        });
        
      case 'joinClass':
        // Get class to check availability
        const classDoc = await databases.getDocument(
          process.env.DATABASE_ID,
          process.env.CLASSES_COLLECTION_ID,
          data.classId
        );
        
        // Check if full
        if (classDoc.members.length >= classDoc.totalSpots) {
          return res.json({
            success: false,
            message: 'Class is full',
            action: 'joinClass'
          }, 400);
        }
        
        // Add user to class
        const updatedMembers = [...classDoc.members, { 
          userId: data.userId, 
          name: data.name 
        }];
        
        await databases.updateDocument(
          process.env.DATABASE_ID,
          process.env.CLASSES_COLLECTION_ID,
          data.classId,
          {
            members: updatedMembers,
            spotsLeft: classDoc.totalSpots - updatedMembers.length
          }
        );
        
        return res.json({
          success: true,
          message: 'Successfully joined class',
          action: 'joinClass'
        });
        
      case 'createClass':
        // Create a new class
        const newClass = await databases.createDocument(
          process.env.DATABASE_ID,
          process.env.CLASSES_COLLECTION_ID,
          ID.unique(),
          {
            type: data.classType,
            day: data.day,
            time: data.time,
            members: data.initialMembers || [],
            totalSpots: data.totalSpots || 5,
            spotsLeft: data.totalSpots - (data.initialMembers?.length || 0) || 5,
            status: 'active',
            createdAt: new Date().toISOString()
          }
        );
        
        return res.json({
          success: true,
          classId: newClass.$id,
          action: 'createClass'
        });
      
      default:
        throw new Error('Invalid action specified');
    }
  } catch (error) {
    console.error(`Error in class management (${req.payload?.action}):`, error);
    return res.json({
      success: false,
      message: `Class operation failed: ${error.message}`,
      error: error.message
    }, 500);
  }
};