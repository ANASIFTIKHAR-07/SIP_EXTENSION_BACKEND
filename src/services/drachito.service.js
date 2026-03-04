// import { createRequire } from 'module';
// const require = createRequire(import.meta.url);
// const Srf = require('drachtio-srf');

// export const srf = new Srf();

// // ✅ MUST be before connect()
// srf.on('error', (err) => {
//   console.error('❌ SRF Error (will retry on next request):', err.message);
// });

// srf.connect({ host: '13.203.27.114', port: 9022, secret: 'cymru' });

// srf.on('connect', (err, hp) => {
//   if (err) return console.error('❌ Error:', err);
//   console.log('✅ Connected. Sending Registration...');
    
//   srf.request('sip:q.sgycm.yeastarcloud.com', {
//     method: 'REGISTER',
//     headers: {
//       'Contact': '<sip:208@13.203.20.182:5070>',
//       'To': 'sip:208@q.sgycm.yeastarcloud.com',
//       'From': 'sip:208@q.sgycm.yeastarcloud.com'
//     },
//     auth: {
//       username: '208',
//       password: 'Smart@0500'
//     }
//   }, (err, req) => {
//     if (err) return console.log('❌ Failed to send:', err);
//     req.on('response', (res) => {
//       console.log(`📩 Status: ${res.status} ${res.reason}`);
//       if (res.status === 200) console.log('🚀 REGISTERED SUCCESS!');
//     });
//   });
// });