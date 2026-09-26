const { runAsync } = require('./db');

// Generate 8-digit OTP for Delivery Person
function generate8DigitOTP() {
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}

// Generate 4-digit OTP for Customer delivery confirmation
function generateCustomerOTP() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// Send Notification (WhatsApp + In-App Web Push)
async function sendNotification({ recipientPhone, recipientRole, channel = 'WHATSAPP', message, otpCode = null, io = null }) {
  try {
    // 1. Log in database
    await runAsync(
      `INSERT INTO notifications_log (recipient_phone, recipient_role, channel, message, otp_code, status)
       VALUES (?, ?, ?, ?, ?, 'SENT')`,
      [recipientPhone, recipientRole, channel, message, otpCode]
    );

    console.log(`[${channel}] [${recipientRole} ${recipientPhone}] OTP: ${otpCode || 'N/A'}`);
    console.log(`Message: ${message}`);

    // 2. Real-time push via Socket.io
    if (io) {
      io.emit('push:notification', {
        recipientPhone,
        recipientRole,
        channel,
        message,
        otpCode,
        timestamp: new Date().toISOString()
      });
    }

    // Direct WhatsApp web link for manual testing or gateway hook
    const cleanPhone = recipientPhone.replace(/[^0-9]/g, '');
    const waLink = `https://wa.me/${cleanPhone.startsWith('88') ? cleanPhone : '88' + cleanPhone}?text=${encodeURIComponent(message)}`;

    return {
      success: true,
      channel,
      recipientPhone,
      otpCode,
      message,
      waLink
    };
  } catch (err) {
    console.error('Notification error:', err);
    return { success: false, error: err.message };
  }
}

// Helper to notify Delivery Person when order is ready
async function notifyDeliveryPersonOrderReady(order, deliveryPersonPhone, io) {
  const message = `🔔 [FOOD DELIVERY RADAR]\nOrder #${order.order_number} is READY FOR PICKUP!\n` +
    `🏪 Restaurant: ${order.restaurant_name}\n` +
    `📍 Pickup: ${order.restaurant_address}\n` +
    `🏠 Deliver to: ${order.delivery_address}\n` +
    `💰 Order Value: ৳${order.total_amount} | Fee: ৳${order.delivery_fee}\n` +
    `🔑 YOUR 8-DIGIT ACCEPTANCE CODE: *${order.delivery_otp}*\n` +
    `⚠️ To accept this delivery, open WebApp and enter this 8-digit OTP code to avoid accidental clicks!`;

  return await sendNotification({
    recipientPhone: deliveryPersonPhone,
    recipientRole: 'delivery',
    channel: 'WHATSAPP',
    message,
    otpCode: order.delivery_otp,
    io
  });
}

// Helper to notify Customer with Delivery Confirmation OTP
async function notifyCustomerOrderUpdate(order, customerPhone, statusDescription, io) {
  let message = `🍽️ [ORDER UPDATE - #${order.order_number}]\n` +
    `Status: ${statusDescription}\n` +
    `Total: ৳${order.total_amount}\n`;

  if (order.customer_otp) {
    message += `🔐 YOUR DELIVERY CONFIRMATION OTP: *${order.customer_otp}*\n` +
      `Give this OTP to the delivery person only after receiving your food!`;
  }

  return await sendNotification({
    recipientPhone: customerPhone,
    recipientRole: 'customer',
    channel: 'WHATSAPP',
    message,
    otpCode: order.customer_otp || null,
    io
  });
}

module.exports = {
  generate8DigitOTP,
  generateCustomerOTP,
  sendNotification,
  notifyDeliveryPersonOrderReady,
  notifyCustomerOrderUpdate
};
