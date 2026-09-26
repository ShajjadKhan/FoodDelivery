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

    // Direct WhatsApp web link for Saudi / International format
    let cleanPhone = recipientPhone.replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('05')) {
      cleanPhone = '966' + cleanPhone.substring(1);
    } else if (cleanPhone.startsWith('5') && cleanPhone.length === 9) {
      cleanPhone = '966' + cleanPhone;
    } else if (!cleanPhone.startsWith('966') && cleanPhone.length === 10) {
      cleanPhone = '966' + cleanPhone;
    }
    const waLink = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;

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

// Helper to notify Delivery Person when order is ready (Saudi Local Vendor Radar)
async function notifyDeliveryPersonOrderReady(order, deliveryPersonPhone, io) {
  const message = `🔔 [رادار مناديب التوصيل | SAUDI VENDOR RADAR]\n` +
    `طلب جديد جاهز للاستلام والتوصيل! (#${order.order_number})\n` +
    `🏪 المتجر / المطعم: ${order.restaurant_name}\n` +
    `📍 موقع الاستلام: ${order.restaurant_address}\n` +
    `🏠 عنوان العميل: ${order.delivery_address}\n` +
    `💰 قيمة الطلب: ${order.total_amount} ر.س (SAR) | أتعاب التوصيل: ${order.delivery_fee} ر.س\n` +
    `🔑 رمز قبول الطلب (8 أرقام): *${order.delivery_otp}*\n` +
    `⚠️ لمنع القبول بالخطأ، افتح التطبيق وأدخل هذا الرمز 8 أرقام لتأكيد الاستلام والانطلاق!`;

  return await sendNotification({
    recipientPhone: deliveryPersonPhone,
    recipientRole: 'delivery',
    channel: 'WHATSAPP',
    message,
    otpCode: order.delivery_otp,
    io
  });
}

// Helper to notify Customer with Delivery Confirmation OTP (Saudi Customer Update)
async function notifyCustomerOrderUpdate(order, customerPhone, statusDescription, io) {
  let message = `🍽️ [تحديث الطلب | ORDER UPDATE - #${order.order_number}]\n` +
    `الحالة: ${statusDescription}\n` +
    `الإجمالي المطلوب: ${order.total_amount} ر.س (SAR)\n`;

  if (order.customer_otp) {
    message += `🔐 رمز تأكيد الاستلام الخاص بك: *${order.customer_otp}*\n` +
      `يرجى تزويد مندوب التوصيل بهذا الرمز فقط عند استلام وجبتك نقداً أو عبر مدى!`;
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
