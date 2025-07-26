// notifications.js - handles all notification types using Mailgun
const Mailgun = require("mailgun.js");
const FormData = require("form-data");
const { Client, Users } = require('node-appwrite');

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
  log("notifications function invoked.");
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
    
    // Initialize Mailgun with FormData
    const mailgun = new Mailgun(FormData);
    const mg = mailgun.client({
      username: "api",
      key: process.env.MAILGUN_API_KEY,
    });
    
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
      case 'sendClassJoinConfirmation':
        log(`Executing action: sendClassJoinConfirmation for user: ${data.userName}, class: ${data.classType}`);
        
        // Generate iCal data for calendar link
        const icalData = generateICalData(data.classType, data.day, data.time, data.userName);
        const icalBlob = Buffer.from(icalData).toString('base64');
        const icalDownloadUrl = `data:text/calendar;base64,${icalBlob}`;
        
        // Send confirmation email to user
        const userEmailResult = await sendUserConfirmationEmail(
          mg, 
          data.userEmail, 
          data.userName, 
          data.classType, 
          data.day, 
          data.time,
          icalDownloadUrl,
          log
        );
        
        // Send notification email to admin
        const adminEmailResult = await sendAdminNotificationEmail(
          mg,
          data.userName,
          data.userEmail,
          data.userPhone,
          data.classType,
          data.day,
          data.time,
          data.currentEnrollment,
          data.totalSpots,
          log
        );
        
        return sendJsonResponse(res, 200, {
          success: true,
          userEmailResult,
          adminEmailResult,
          action: 'sendClassJoinConfirmation'
        }, log, logError);
        
      case 'newMatch':
        // Notify users about a new class match
        const results = await notifyUsers(
          users, 
          mg, 
          data.userIds, 
          data.classDetails,
          log
        );
        
        return sendJsonResponse(res, 200, {
          success: true,
          notificationResults: results,
          action: 'newMatch'
        }, log, logError);
        
      case 'classReminder':
        // Send reminder about upcoming class
        const reminderResults = await sendClassReminders(
          users, 
          mg, 
          data.classId, 
          data.classDetails,
          data.message,
          log
        );
        
        return sendJsonResponse(res, 200, {
          success: true,
          reminderResults: reminderResults,
          action: 'classReminder'
        }, log, logError);
      
      case 'sendWelcome':
        // Send welcome message to new user
        const welcomeResult = await sendWelcomeMessage(
          mg,
          data.email,
          data.name,
          log
        );
        
        return sendJsonResponse(res, 200, {
          success: true,
          welcomeResult: welcomeResult,
          action: 'sendWelcome'
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
    logError("An error occurred in notifications function execution:");
    logError(`Error Message: ${error.message}`);
    logError(`Error Stack: ${error.stack}`);
    if (error.response) {
      logError(`Error Response: ${JSON.stringify(error.response)}`);
    }
    
    return sendJsonResponse(res, 500, {
      success: false,
      message: `Notification operation failed: ${error.message}`,
      errorDetails: error.toString()
    }, log, logError);
  }
};

// Generate iCal data for calendar download
function generateICalData(classType, day, time, userName) {
  // Calculate next occurrence of the day
  const getNextDate = (dayName) => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const today = new Date();
    const todayDay = today.getDay();
    const targetDay = days.indexOf(dayName);
    
    let daysUntilTarget = targetDay - todayDay;
    if (daysUntilTarget <= 0) {
      daysUntilTarget += 7; // Next week
    }
    
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + daysUntilTarget);
    return targetDate;
  };

  // Parse time and create start/end dates
  const parseTime = (timeStr) => {
    const [time, period] = timeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);
    
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    
    return { hours, minutes };
  };

  const classDate = getNextDate(day);
  const { hours, minutes } = parseTime(time);
  
  const startDate = new Date(classDate);
  startDate.setHours(hours, minutes, 0, 0);
  
  const endDate = new Date(startDate);
  endDate.setHours(hours + 1, minutes, 0, 0); // Assume 1 hour duration

  // Format dates for iCal
  const formatDateForICal = (date) => {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  };

  const title = `${classType.charAt(0).toUpperCase() + classType.slice(1)} Language Class`;
  const description = `Your ${classType} language class with Mandarin Tutor HK. Looking forward to seeing you there!`;

  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Mandarin Tutor HK//Class Scheduler//EN
BEGIN:VEVENT
DTSTART:${formatDateForICal(startDate)}
DTEND:${formatDateForICal(endDate)}
SUMMARY:${title}
DESCRIPTION:${description}
LOCATION:Online
END:VEVENT
END:VCALENDAR`;
}

// Send confirmation email to user
async function sendUserConfirmationEmail(mg, userEmail, userName, classType, day, time, icalDownloadUrl, log) {
  try {
    log(`Sending confirmation email to user: ${userEmail}`);
    
    const subject = `You're enrolled! Your ${classType.charAt(0).toUpperCase() + classType.slice(1)} class starts ${day} at ${time}`;
    
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Hi ${userName},</h2>
        
        <p>Great news! You've successfully enrolled in a ${classType.charAt(0).toUpperCase() + classType.slice(1)} class.</p>
        
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #333; margin-top: 0;">📅 Class Details:</h3>
          <ul style="list-style: none; padding: 0;">
            <li style="margin: 8px 0;">• <strong>Day:</strong> ${day}</li>
            <li style="margin: 8px 0;">• <strong>Time:</strong> ${time}</li>
            <li style="margin: 8px 0;">• <strong>Class Type:</strong> ${classType.charAt(0).toUpperCase() + classType.slice(1)}</li>
          </ul>
        </div>
        
        <h3 style="color: #333;">🎯 What's Next?</h3>
        <ol>
          <li style="margin: 8px 0;">Add this class to your calendar: <a href="${icalDownloadUrl}" download="class-schedule.ics" style="color: #7e55f6;">iCal Download Link</a></li>
          <li style="margin: 8px 0;">We'll send you a reminder 24 hours before your first class</li>
          <li style="margin: 8px 0;">Look out for class materials and joining instructions</li>
        </ol>
        
        <p style="margin-top: 30px;">
          <strong>📧 Questions?</strong><br>
          If you have any questions or need to make changes, just reply to this email or contact your tutor at aileen@mandarintutorhk.com.
        </p>
        
        <p>We're excited to help you on your language learning journey!</p>
        
        <p>Best regards,<br>The Mandarin Tutor HK Team</p>
      </div>
    `;

    const textContent = `Hi ${userName},

Great news! You've successfully enrolled in a ${classType.charAt(0).toUpperCase() + classType.slice(1)} class.

📅 Class Details:
• Day: ${day}
• Time: ${time}
• Class Type: ${classType.charAt(0).toUpperCase() + classType.slice(1)}

🎯 What's Next?
1. Add this class to your calendar: ${icalDownloadUrl}
2. We'll send you a reminder 24 hours before your first class
3. Look out for class materials and joining instructions

📧 Questions?
If you have any questions or need to make changes, just reply to this email or contact your tutor at aileen@mandarintutorhk.com.

We're excited to help you on your language learning journey!

Best regards,
The Mandarin Tutor HK Team`;

    const data = await mg.messages.create("mandarintutorhk.com", {
      from: "Mandarin Tutor HK <postmaster@mandarintutorhk.com>",
      to: [userEmail],
      subject: subject,
      text: textContent,
      html: htmlContent
    });
    
    log(`User confirmation email sent successfully to ${userEmail}`);
    return { success: true, data };
  } catch (error) {
    log(`Error sending user confirmation email: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Send notification email to admin
async function sendAdminNotificationEmail(mg, userName, userEmail, userPhone, classType, day, time, currentEnrollment, totalSpots, log) {
  try {
    log(`Sending admin notification email for new enrollment: ${userName}`);
    
    const subject = `🎉 New student enrolled: ${userName} joined ${classType.charAt(0).toUpperCase() + classType.slice(1)} class (${day} ${time})`;
    
    const isClassFull = currentEnrollment >= totalSpots;
    
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Hi Aileen,</h2>
        
        <p>A new student has just enrolled in one of your classes!</p>
        
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #333; margin-top: 0;">👤 Student Information:</h3>
          <ul style="list-style: none; padding: 0;">
            <li style="margin: 8px 0;">• <strong>Name:</strong> ${userName}</li>
            <li style="margin: 8px 0;">• <strong>Email:</strong> ${userEmail}</li>
            <li style="margin: 8px 0;">• <strong>Phone:</strong> ${userPhone}</li>
          </ul>
        </div>
        
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #333; margin-top: 0;">📅 Class Details:</h3>
          <ul style="list-style: none; padding: 0;">
            <li style="margin: 8px 0;">• <strong>Class Type:</strong> ${classType.charAt(0).toUpperCase() + classType.slice(1)}</li>
            <li style="margin: 8px 0;">• <strong>Day:</strong> ${day}</li>
            <li style="margin: 8px 0;">• <strong>Time:</strong> ${time}</li>
            <li style="margin: 8px 0;">• <strong>Current enrollment:</strong> ${currentEnrollment} of ${totalSpots} spots</li>
          </ul>
        </div>
        
        ${isClassFull ? `
        <div style="background-color: #d4edda; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
          <h3 style="color: #155724; margin-top: 0;">💡 Class Status:</h3>
          <p style="color: #155724; margin: 0;">This class is now full!</p>
        </div>
        ` : ''}
        
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #333; margin-top: 0;">🔗 Quick Actions:</h3>
          <p style="margin: 8px 0;">• View class details in admin dashboard</p>
        </div>
        
        <p style="color: #666; font-size: 14px; margin-top: 30px;">
          This notification was sent automatically when a student joined a class.
        </p>
      </div>
    `;

    const textContent = `Hi Aileen,

A new student has just enrolled in one of your classes!

👤 Student Information:
• Name: ${userName}
• Email: ${userEmail}
• Phone: ${userPhone}

📅 Class Details:
• Class Type: ${classType.charAt(0).toUpperCase() + classType.slice(1)}
• Day: ${day}
• Time: ${time}
• Current enrollment: ${currentEnrollment} of ${totalSpots} spots

${isClassFull ? '💡 Class Status:\nThis class is now full!' : ''}

🔗 Quick Actions:
• View class details in admin dashboard

This notification was sent automatically when a student joined a class.`;

    const data = await mg.messages.create("mandarintutorhk.com", {
      from: "Mandarin Tutor HK <postmaster@mandarintutorhk.com>",
      to: ["aileen@mandarintutorhk.com"],
      subject: subject,
      text: textContent,
      html: htmlContent
    });
    
    log(`Admin notification email sent successfully`);
    return { success: true, data };
  } catch (error) {
    log(`Error sending admin notification email: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Legacy functions (keeping for compatibility)
async function notifyUsers(users, mg, userIds, classDetails, log) {
  const results = [];
  
  for (const userId of userIds) {
    try {
      // Get user info
      const user = await users.get(userId);
      const prefs = await users.getPrefs(userId);
      
      // Send email notification using Mailgun
      if (user.email) {
        await sendMailgunEmail(
          mg,
          user.email,
          user.name,
          'New Class Match Found!',
          `A new ${classDetails.type} class has been formed on ${classDetails.day} at ${classDetails.time}. Log in to join!`,
          // HTML version
          `<h2>New Class Match!</h2>
           <p>Good news! A new ${classDetails.type} class has been formed on <strong>${classDetails.day}</strong> at <strong>${classDetails.time}</strong>.</p>
           <p><a href="${process.env.APP_URL}/classes">Click here to join the class</a></p>`,
          log
        );
      }
      
      results.push({
        userId,
        status: 'success',
        methods: [user.email ? 'email' : null].filter(Boolean)
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

async function sendClassReminders(users, mg, classId, classDetails, message, log) {
  const results = [];
  
  // Get all users in the class
  const userIds = classDetails.members.map(member => member.userId);
  
  for (const userId of userIds) {
    try {
      // Get user info
      const user = await users.get(userId);
      
      // Send email reminder
      if (user.email) {
        await sendMailgunEmail(
          mg,
          user.email,
          user.name,
          `Reminder: ${classDetails.type} Class Tomorrow`,
          `Reminder: Your ${classDetails.type} class is scheduled for tomorrow, ${classDetails.day} at ${classDetails.time}.`,
          // HTML version
          `<h2>Class Reminder</h2>
           <p>This is a reminder that your ${classDetails.type} class is scheduled for tomorrow, <strong>${classDetails.day}</strong> at <strong>${classDetails.time}</strong>.</p>
           <p>${message || ''}</p>`,
          log
        );
      }
      
      results.push({
        userId,
        status: 'success',
        methods: [user.email ? 'email' : null].filter(Boolean)
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

async function sendWelcomeMessage(mg, email, name, log) {
  try {
    await sendMailgunEmail(
      mg,
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
       <p><a href="${process.env.APP_URL}/classes">Get started now</a></p>`,
      log
    );
    
    return { success: true, email };
  } catch (error) {
    log(`Error sending welcome email: ${error.message}`);
    return { success: false, error: error.message, email };
  }
}

async function sendMailgunEmail(mg, toEmail, toName, subject, textContent, htmlContent, log) {
  const data = await mg.messages.create("mandarintutorhk.com", {
    from: "Mandarin Tutor HK <postmaster@mandarintutorhk.com>",
    to: [toEmail],
    subject: subject,
    text: textContent,
    html: htmlContent
  });
  
  log(`Email sent successfully to ${toEmail}`);
  return data;
}