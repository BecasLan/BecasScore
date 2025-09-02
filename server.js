const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Statik dosyalar için public klasörünü kullan
app.use(express.static(path.join(__dirname, 'public')));

// Ana sayfayı sun
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Sunucuyu başlat
app.listen(PORT, () => {
  console.log(`BecasBot Website sunucusu ${PORT} portunda çalışıyor!`);
  console.log(`http://localhost:${PORT} adresini ziyaret edin`);
});