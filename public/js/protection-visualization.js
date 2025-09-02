// Basitleştirilmiş Koruma Sistemi Görselleştirmesi
class ProtectionVisualization {
  constructor() {
    this.canvas = document.getElementById('protection-canvas');
    this.ctx = this.canvas.getContext('2d');
    
    this.resize();
    
    // Temel elementler
    this.nodes = [];
    this.links = [];
    this.attacks = [];
    
    // Ağ yapısını oluştur
    this.createNodes();
    this.createLinks();
    
    // İstatistik sayaçlarını başlat
    this.initStats();
    
    window.addEventListener('resize', this.resize.bind(this));
    this.animate();
    
    // Düzenli aralıklarla saldırı oluştur
    setInterval(() => {
      this.createAttack();
    }, 5000);
  }
  
  resize() {
    const container = this.canvas.parentElement;
    this.width = container.offsetWidth;
    this.height = container.offsetHeight;
    
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    
    // Pencere boyutu değiştiğinde düğümleri yeniden oluştur
    if (this.nodes.length > 0) {
      this.nodes = [];
      this.links = [];
      this.createNodes();
      this.createLinks();
    }
  }
  
  createNodes() {
    // Sunucular (yeşil düğümler)
    const serverCount = 20; // Daha az düğüm
    
    for (let i = 0; i < serverCount; i++) {
      this.nodes.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        radius: 4,
        color: '#4CAF50',
        type: 'server',
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3
      });
    }
    
    // Becas koruma noktaları (mavi düğümler)
    const becasCount = 5;
    
    for (let i = 0; i < becasCount; i++) {
      this.nodes.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        radius: 6,
        color: '#5865F2',
        type: 'becas',
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.2
      });
    }
    
    // Tehdit noktaları (kırmızı düğümler)
    const threatCount = 3;
    
    for (let i = 0; i < threatCount; i++) {
      this.nodes.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        radius: 5,
        color: '#F44336',
        type: 'threat',
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5
      });
    }
  }
  
  createLinks() {
    // BecasBot koruma noktalarını sunuculara bağla
    const serverNodes = this.nodes.filter(node => node.type === 'server');
    const becasNodes = this.nodes.filter(node => node.type === 'becas');
    
    becasNodes.forEach(becas => {
      // Her Becas noktasını birkaç sunucuya bağla
      const connectionCount = 3 + Math.floor(Math.random() * 2);
      const targetServers = [...serverNodes].sort(() => 0.5 - Math.random()).slice(0, connectionCount);
      
      targetServers.forEach(server => {
        this.links.push({
          from: becas,
          to: server,
          color: '#5865F2',
          width: 1,
          opacity: 0.3
        });
      });
    });
  }
  
  createAttack() {
    // Rasgele bir tehdit noktası seç
    const threatNodes = this.nodes.filter(node => node.type === 'threat');
    const serverNodes = this.nodes.filter(node => node.type === 'server');
    
    if (threatNodes.length === 0 || serverNodes.length === 0) return;
    
    const threat = threatNodes[Math.floor(Math.random() * threatNodes.length)];
    const target = serverNodes[Math.floor(Math.random() * serverNodes.length)];
    
    this.attacks.push({
      from: threat,
      to: target,
      progress: 0,
      speed: 0.01,
      color: '#F44336'
    });
    
    // Saldırı bitince savunma oluştur
    setTimeout(() => {
      this.createDefense(target);
    }, 3000);
  }
  
  createDefense(target) {
    // En yakın Becas noktasını bul
    const becasNodes = this.nodes.filter(node => node.type === 'becas');
    if (becasNodes.length === 0) return;
    
    let closest = becasNodes[0];
    let minDistance = Infinity;
    
    becasNodes.forEach(becas => {
      const dx = becas.x - target.x;
      const dy = becas.y - target.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < minDistance) {
        minDistance = distance;
        closest = becas;
      }
    });
    
    // Savunma animasyonu oluştur
    this.attacks.push({
      from: closest,
      to: target,
      progress: 0,
      speed: 0.02,
      color: '#00BFFF',
      isDefense: true
    });
    
    // Hedefi vurgula
    target.highlight = true;
    setTimeout(() => {
      target.highlight = false;
    }, 2000);
  }
  
  initStats() {
    // Sayaç animasyonları
    const counters = document.querySelectorAll('.stat-number');
    
    counters.forEach(counter => {
      const target = parseInt(counter.dataset.count);
      const duration = 2000;
      const startTime = Date.now();
      
      const updateCounter = () => {
        const currentTime = Date.now();
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Easing function
        const easeOut = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
        const current = Math.floor(easeOut * target);
        
        counter.textContent = current.toLocaleString();
        
        if (progress < 1) {
          requestAnimationFrame(updateCounter);
        }
      };
      
      updateCounter();
    });
  }
  
  update() {
    // Düğümleri güncelle
    this.nodes.forEach(node => {
      // Sınırlara çarpma kontrolü
      if (node.x + node.radius > this.width || node.x - node.radius < 0) {
        node.vx *= -1;
      }
      if (node.y + node.radius > this.height || node.y - node.radius < 0) {
        node.vy *= -1;
      }
      
      // Pozisyonu güncelle
      node.x += node.vx;
      node.y += node.vy;
    });
    
    // Saldırı ve savunmaları güncelle
    this.attacks.forEach((attack, index) => {
      attack.progress += attack.speed;
      
      if (attack.progress >= 1) {
        this.attacks.splice(index, 1);
      }
    });
  }
  
  draw() {
    // Canvas'ı temizle
    this.ctx.clearRect(0, 0, this.width, this.height);
    
    // Arkaplan
    this.ctx.fillStyle = 'rgba(15, 15, 15, 0.6)';
    this.ctx.fillRect(0, 0, this.width, this.height);
    
    // Bağlantıları çiz
    this.links.forEach(link => {
      this.ctx.beginPath();
      this.ctx.moveTo(link.from.x, link.from.y);
      this.ctx.lineTo(link.to.x, link.to.y);
      this.ctx.strokeStyle = link.color;
      this.ctx.globalAlpha = link.opacity;
      this.ctx.lineWidth = link.width;
      this.ctx.stroke();
    });
    
    // Saldırı ve savunmaları çiz
    this.attacks.forEach(attack => {
      this.ctx.beginPath();
      
      // Başlangıç ve hedef arasında ilerleme
      const fromX = attack.from.x;
      const fromY = attack.from.y;
      const toX = attack.to.x;
      const toY = attack.to.y;
      
      // İlerleme oranına göre mevcut konum
      const currentX = fromX + (toX - fromX) * attack.progress;
      const currentY = fromY + (toY - fromY) * attack.progress;
      
      this.ctx.moveTo(fromX, fromY);
      this.ctx.lineTo(currentX, currentY);
      
      this.ctx.strokeStyle = attack.color;
      this.ctx.globalAlpha = 0.7;
      this.ctx.lineWidth = attack.isDefense ? 2 : 1;
      this.ctx.stroke();
      
      // Hareket eden nokta
      this.ctx.beginPath();
      this.ctx.arc(currentX, currentY, 3, 0, Math.PI * 2);
      this.ctx.fillStyle = attack.color;
      this.ctx.globalAlpha = 1;
      this.ctx.fill();
    });
    
    // Düğümleri çiz
    this.nodes.forEach(node => {
      this.ctx.beginPath();
      this.ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      
      // Vurgulanan düğümler için glow efekti
      if (node.highlight) {
        this.ctx.shadowBlur = 15;
        this.ctx.shadowColor = '#00BFFF';
      }
      
      this.ctx.fillStyle = node.color;
      this.ctx.globalAlpha = 1;
      this.ctx.fill();
      
      // Glow'u sıfırla
      this.ctx.shadowBlur = 0;
    });
  }
  
  animate() {
    this.update();
    this.draw();
    requestAnimationFrame(this.animate.bind(this));
  }
}

// Sayfa yüklendiğinde başlat
window.addEventListener('load', () => {
  new ProtectionVisualization();
});