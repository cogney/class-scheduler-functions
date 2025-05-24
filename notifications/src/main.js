// notifications.js - handles all notification types using Mailjet and SMS
const { Client, Users } = require('node-appwrite');
const Mailjet = require('node-mailjet');
const twilio = require('twilio');

module.exports = async function(req, res) {
  const client = new Client()
    .setEndpoint('https://cloud.appwrite.io/v1')
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const users = new Users(client);
  
  // Initialize Mailjet
  const mailjet = Mailjet.apiConnect(
    process.env.MAILJET_API_KEY,
    process.env.MAILJET_SECRET_KEY
  );
  
  // Initialize Twilio for SMS
  const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  
  try {
    const { action, ...data } = JSON.parse(req.payload || '{}');
    
    switch (action) {
      case 'newMatch':
        // Notify users about a new class match
        const results = await notifyUsers(
          users, 
          mailjet, 
          twilioClient, 
          data.userIds, 
          data.classDetails
        );
        
        return res.json({
          success: true,
          notificationResults: results,
          action: 'newMatch'
        });
        
      case 'classReminder':
        // Send reminder about upcoming class
        const reminderResults = await sendClassReminders(
          users, 
          mailjet, 
          twilioClient, 
          data.classId, 
          data.classDetails,
          data.message
        );
        
        return res.json({
          success: true,
          reminderResults: reminderResults,
          action: 'classReminder'
        });
      
      case 'sendWelcome':
        // Send welcome message to new user
        const welcomeResult = await sendWelcomeMessage(
          mailjet,
          data.email,
          data.name
        );
        
        return res.json({
          success: true,
          welcomeResult: welcomeResult,
          action: 'sendWelcome'
        });
        
      default:
        throw new Error('Invalid action specified');
    }
  } catch (error) {
    console.error(`Error in notifications (${req.payload?.action}):`, error);
    return res.json({
      success: false,
      message: `Notification operation failed: ${error.message}`,
      error: error.message
    }, 500);
  }
};

async function notifyUsers(users, mailjet, twilioClient, userIds, classDetails) {
  const results = [];
  
  for (const userId of userIds) {
    try {
      // Get user info
      const user = await users.get(userId);
      const prefs = await users.getPrefs(userId);
      
      // Send email notification
      if (user.email) {
        await sendMailjetEmail(
          mailjet,
          user.email,
          user.name,
          'New Class Match Found!',
          `A new ${classDetails.type} class has been formed on ${classDetails.day} at ${classDetails.time}. Log in to join!`,
          // HTML version
          `<h2>New Class Match!</h2>
           <p>Good news! A new ${classDetails.type} class has been formed on <strong>${classDetails.day}</strong> at <strong>${classDetails.time}</strong>.</p>
           <p><a href="${process.env.APP_URL}/classes">Click here to join the class</a></p>`
        );
      }
      
      // Send SMS notification if phone exists
      if (prefs.phone) {
        await sendSMS(
          twilioClient,
          prefs.phone,
          `New ${classDetails.type} class match found on ${classDetails.day} at ${classDetails.time}! Log in to join!`
        );
      }
      
      results.push({
        userId,
        status: 'success',
        methods: [user.email ? 'email' : null, prefs.phone ? 'sms' : null].filter(Boolean)
      });
    } catch (error) {
      results.push({
        userId,
        status: 'error',
        error: error.message
      });
    }
  }
  
  return results;
}

async function sendClassReminders(users, mailjet, twilioClient, classId, classDetails, message) {
  const results = [];
  
  // Get all users in the class
  const userIds = classDetails.members.map(member => member.userId);
  
  for (const userId of userIds) {
    try {
      // Get user info
      const user = await users.get(userId);
      const prefs = await users.getPrefs(userId);
      
      // Send email reminder
      if (user.email) {
        await sendMailjetEmail(
          mailjet,
          user.email,
          user.name,
          `Reminder: ${classDetails.type} Class Tomorrow`,
          `Reminder: Your ${classDetails.type} class is scheduled for tomorrow, ${classDetails.day} at ${classDetails.time}.`,
          // HTML version
          `<h2>Class Reminder</h2>
           <p>This is a reminder that your ${classDetails.type} class is scheduled for tomorrow, <strong>${classDetails.day}</strong> at <strong>${classDetails.time}</strong>.</p>
           <p>${message || ''}</p>`
        );
      }
      
      // Send SMS reminder if phone exists
      if (prefs.phone) {
        await sendSMS(
          twilioClient,
          prefs.phone,
          `Reminder: Your ${classDetails.type} class is tomorrow, ${classDetails.day} at ${classDetails.time}.`
        );
      }
      
      results.push({
        userId,
        status: 'success',
        methods: [user.email ? 'email' : null, prefs.phone ? 'sms' : null].filter(Boolean)
      });
    } catch (error) {
      results.push({
        userId,
        status: 'error',
        error: error.message
      });
    }
  }
  
  return results;
}

async function sendWelcomeMessage(mailjet, email, name) {
  try {
    await sendMailjetEmail(
      mailjet,
      email,
      name,
      'Welcome to the Language Class Scheduler!',
      `Welcome to the Language Class Scheduler! Get started by setting your availability or joining an existing class.`,
      // HTML version
      `<h2>Welcome to the Language Class Scheduler!</h2>
       <p>Hi ${name},</p>
       <p>Thank you for signing up! You're now ready to start your language learning journey.</p>
       <p>You can:</p>
       <ul>
         <li>Join an existing class that fits your schedule</li>
         <li>Set your availability to be matched with others</li>
       </ul>
       <p><a href="${process.env.APP_URL}/classes">Get started now</a></p>`
    );
    
    return { success: true, email };
  } catch (error) {
    console.error('Error sending welcome email:', error);
    return { success: false, error: error.message, email };
  }
}

async function sendMailjetEmail(mailjet, toEmail, toName, subject, textContent, htmlContent) {
  const request = mailjet.post('send', { version: 'v3.1' }).request({
    Messages: [
      {
        From: {
          Email: process.env.MAILJET_FROM_EMAIL,
          Name: process.env.MAILJET_FROM_NAME || "Language Class Scheduler"
        },
        To: [
          {
            Email: toEmail,
            Name: toName
          }
        ],
        Subject: subject,
        TextPart: textContent,
        HTMLPart: htmlContent
      }
    ]
  });
  
  return await request;
}

async function sendSMS(twilioClient, to, message) {
  return await twilioClient.messages.create({
    body: message,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: to
  });
}