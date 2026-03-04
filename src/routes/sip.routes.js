// import { srf } from '../services/drachito.service.js';

// // ✅ Guard in case srf isn't connected yet
// srf.on('error', (err) => {
//   console.error('❌ SRF invite listener error:', err.message);
// });

// srf.invite((req, res) => {
//   res.send(200, {
//     headers: {
//       'Content-Type': 'application/sdp'
//     }
//   });
//   console.log('🚀 SUCCESS! Got INVITE, sent 200 OK');
// });