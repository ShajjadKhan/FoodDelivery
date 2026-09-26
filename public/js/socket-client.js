// Shared Socket.io & Notification Engine
const socket = io();

// Web Audio API Synthesizer for alerts (no external audio files needed)
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playTone(freq = 660, type = 'sine', duration = 0.2, delay = 0) {
  setTimeout(() => {
    try {
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
      console.warn('Audio play error:', e);
    }
  }, delay);
}

// Order chime (Restaurant)
function playNewOrderChime() {
  playTone(523.25, 'triangle', 0.25, 0);   // C5
  playTone(659.25, 'triangle', 0.25, 120); // E5
  playTone(783.99, 'triangle', 0.4, 240);  // G5
}

// Delivery Radar Radar alert (Delivery Person)
function playRadarAlert() {
  playTone(880, 'sawtooth', 0.15, 0);
  playTone(1174.66, 'sine', 0.25, 150);
  playTone(880, 'sawtooth', 0.15, 300);
  playTone(1174.66, 'sine', 0.35, 450);
}

// General Success Chime
function playSuccessChime() {
  playTone(587.33, 'sine', 0.2, 0);
  playTone(880, 'sine', 0.3, 150);
}

// Real-time WhatsApp Notification Preview Listener
socket.on('push:notification', (data) => {
  console.log('Incoming WhatsApp Notification:', data);
  showWhatsAppPreview(data);
});

// Display Floating WhatsApp Simulator Notification
function showWhatsAppPreview(data) {
  let drawer = document.getElementById('waSimulatorDrawer');
  if (!drawer) {
    drawer = document.createElement('div');
    drawer.id = 'waSimulatorDrawer';
    drawer.className = 'wa-drawer';
    drawer.innerHTML = `
      <div class="wa-card">
        <div class="wa-header">
          <span>💬 WhatsApp Live Push (${data.recipientRole.toUpperCase()})</span>
          <button onclick="this.closest('.wa-drawer').style.display='none'" style="background:none;border:none;color:white;cursor:pointer;font-weight:bold;">&times;</button>
        </div>
        <div class="wa-body" id="waBody"></div>
      </div>
    `;
    document.body.appendChild(drawer);
  }

  drawer.style.display = 'block';
  const body = document.getElementById('waBody');
  const bubble = document.createElement('div');
  bubble.className = 'wa-bubble';

  let otpBadge = '';
  if (data.otpCode) {
    otpBadge = `<div style="font-weight:bold;color:#1e3a8a;margin-top:4px;background:#e0f2fe;padding:3px 6px;border-radius:4px;">🔑 Verification OTP: ${data.otpCode}</div>`;
  }

  bubble.innerHTML = `
    <div style="font-size:0.7rem;color:#059669;font-weight:bold;margin-bottom:2px;">To: ${data.recipientPhone}</div>
    ${data.message.replace(/\n/g, '<br>')}
    ${otpBadge}
  `;
  body.prepend(bubble);

  // Auto scroll to top
  body.scrollTop = 0;
}

// Simple Toast Notification
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.style.position = 'fixed';
  toast.style.top = '1.5rem';
  toast.style.right = '1.5rem';
  toast.style.zIndex = '999';
  toast.style.background = type === 'error' ? '#ef4444' : (type === 'success' ? '#10b981' : '#1e293b');
  toast.style.color = '#ffffff';
  toast.style.padding = '0.75rem 1.25rem';
  toast.style.borderRadius = '8px';
  toast.style.boxShadow = '0 10px 15px -3px rgba(0,0,0,0.2)';
  toast.style.fontWeight = '600';
  toast.style.fontSize = '0.875rem';
  toast.innerText = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 0.4s';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}
