// Basitleştirilmiş 3D Dünya Animasyonu
class WorldAnimation {
  constructor() {
    this.container = document.getElementById('world-animation');
    this.width = this.container.offsetWidth;
    this.height = this.container.offsetHeight;
    
    // Temel Three.js kurulumu
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, this.width / this.height, 0.1, 1000);
    this.camera.position.set(0, 0, 400);
    
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);
    
    // Ekran boyutu değişikliğini dinle
    window.addEventListener('resize', this.onResize.bind(this));
    
    // Elementleri oluştur
    this.initLights();
    this.createGlobe();
    this.createDiscordPoints();
    this.createConnections();
    
    // Animasyon döngüsü
    this.animate();
  }
  
  initLights() {
    // Basit ışıklandırma
    const ambientLight = new THREE.AmbientLight(0x404040, 1);
    this.scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(1, 1, 1);
    this.scene.add(directionalLight);
    
    // Discord renk tonunda ışık
    const discordLight = new THREE.PointLight(0x5865F2, 2, 500);
    discordLight.position.set(-200, 200, 200);
    this.scene.add(discordLight);
  }
  
  createGlobe() {
    // Basit grid dünya
    const geometry = new THREE.SphereGeometry(150, 32, 32);
    const material = new THREE.MeshBasicMaterial({
      color: 0x151515,
      wireframe: true,
      transparent: true,
      opacity: 0.5
    });
    
    this.globe = new THREE.Mesh(geometry, material);
    this.scene.add(this.globe);
    
    // İç küre (ana gövde)
    const innerGeometry = new THREE.SphereGeometry(145, 32, 32);
    const innerMaterial = new THREE.MeshBasicMaterial({
      color: 0x111111,
      transparent: true,
      opacity: 0.7
    });
    
    this.innerGlobe = new THREE.Mesh(innerGeometry, innerMaterial);
    this.scene.add(this.innerGlobe);
  }
  
  createDiscordPoints() {
    // Discord sunucuları (noktalar)
    this.points = [];
    const pointCount = 40; // Daha az nokta
    
    // Nokta geometrisi ve materyali
    const geometry = new THREE.SphereGeometry(2, 8, 8);
    const material = new THREE.MeshBasicMaterial({ color: 0x5865F2 });
    
    for (let i = 0; i < pointCount; i++) {
      // Küre üzerinde rasgele dağılım
      const phi = Math.acos(-1 + (2 * i) / pointCount);
      const theta = Math.sqrt(pointCount * Math.PI) * phi;
      
      const x = 150 * Math.sin(phi) * Math.cos(theta);
      const y = 150 * Math.sin(phi) * Math.sin(theta);
      const z = 150 * Math.cos(phi);
      
      const point = new THREE.Mesh(geometry, material);
      point.position.set(x, y, z);
      
      // Nokta verisi
      point.userData = {
        isProtected: Math.random() > 0.3, // %70 korunuyor
        pulseSpeed: 0.5 + Math.random()
      };
      
      this.scene.add(point);
      this.points.push(point);
    }
    
    // Koruma noktaları (daha büyük mavi noktalar)
    const protectionCount = 5;
    const protectionGeometry = new THREE.SphereGeometry(4, 16, 16);
    const protectionMaterial = new THREE.MeshBasicMaterial({ color: 0x00BFFF });
    
    this.protectionPoints = [];
    
    for (let i = 0; i < protectionCount; i++) {
      const phi = Math.acos(-1 + (2 * i) / protectionCount);
      const theta = Math.sqrt(protectionCount * Math.PI) * phi;
      
      const x = 150 * Math.sin(phi) * Math.cos(theta);
      const y = 150 * Math.sin(phi) * Math.sin(theta);
      const z = 150 * Math.cos(phi);
      
      const point = new THREE.Mesh(protectionGeometry, protectionMaterial);
      point.position.set(x, y, z);
      
      this.scene.add(point);
      this.protectionPoints.push(point);
    }
  }
  
  createConnections() {
    // Noktalar arası bağlantılar
    this.connections = [];
    
    // Koruma noktalarını sunuculara bağla
    this.protectionPoints.forEach(protectionPoint => {
      // Her koruma noktasını birkaç sunucuya bağla
      const connectionCount = 3 + Math.floor(Math.random() * 4);
      
      for (let i = 0; i < connectionCount; i++) {
        const randomPoint = this.points[Math.floor(Math.random() * this.points.length)];
        
        const geometry = new THREE.BufferGeometry().setFromPoints([
          protectionPoint.position,
          randomPoint.position
        ]);
        
        const material = new THREE.LineBasicMaterial({ 
          color: 0x00BFFF,
          transparent: true,
          opacity: 0.3
        });
        
        const line = new THREE.Line(geometry, material);
        this.scene.add(line);
        this.connections.push({
          line,
          from: protectionPoint,
          to: randomPoint,
          pulse: 0
        });
      }
    });
  }
  
  // Rastgele bir saldırı ve savunma animasyonu oluştur
  createAttackDefense() {
    // Rasgele saldırı noktası (kırmızı)
    const attackGeometry = new THREE.SphereGeometry(3, 8, 8);
    const attackMaterial = new THREE.MeshBasicMaterial({ color: 0xFF4500 });
    
    // Rasgele bir pozisyon (dünya dışında)
    const phi = Math.random() * Math.PI * 2;
    const theta = Math.random() * Math.PI;
    
    const x = 250 * Math.sin(theta) * Math.cos(phi);
    const y = 250 * Math.sin(theta) * Math.sin(phi);
    const z = 250 * Math.cos(theta);
    
    const attackPoint = new THREE.Mesh(attackGeometry, attackMaterial);
    attackPoint.position.set(x, y, z);
    this.scene.add(attackPoint);
    
    // Hedef (rasgele bir Discord noktası)
    const targetPoint = this.points[Math.floor(Math.random() * this.points.length)];
    
    // Saldırı çizgisi
    const attackGeom = new THREE.BufferGeometry().setFromPoints([
      attackPoint.position,
      targetPoint.position
    ]);
    
    const attackLineMaterial = new THREE.LineBasicMaterial({ 
      color: 0xFF4500,
      transparent: true,
      opacity: 0.7
    });
    
    const attackLine = new THREE.Line(attackGeom, attackLineMaterial);
    this.scene.add(attackLine);
    
    // Animasyon için objeleri takip et
    const attack = {
      point: attackPoint,
      line: attackLine,
      target: targetPoint,
      progress: 0
    };
    
    // Saldırı animasyonu
    const animateAttack = () => {
      if (attack.progress < 1) {
        attack.progress += 0.01;
        requestAnimationFrame(animateAttack);
        
        // Saldırı noktasını hareket ettir
        const newPos = new THREE.Vector3().lerpVectors(
          attack.point.position,
          attack.target.position,
          attack.progress
        );
        
        attack.point.position.copy(newPos);
        
        // Çizgiyi güncelle
        attack.line.geometry.setFromPoints([
          newPos,
          attack.target.position
        ]);
      } else {
        // Saldırı bittiğinde savunma başlat
        this.createDefense(targetPoint);
        
        // Elementleri temizle
        this.scene.remove(attack.point);
        this.scene.remove(attack.line);
      }
    };
    
    animateAttack();
  }
  
  createDefense(targetPoint) {
    // En yakın koruma noktasını bul
    let closestProtection = this.protectionPoints[0];
    let minDistance = Infinity;
    
    this.protectionPoints.forEach(protectionPoint => {
      const distance = protectionPoint.position.distanceTo(targetPoint.position);
      if (distance < minDistance) {
        minDistance = distance;
        closestProtection = protectionPoint;
      }
    });
    
    // Savunma çizgisi
    const defenseGeom = new THREE.BufferGeometry().setFromPoints([
      closestProtection.position,
      targetPoint.position
    ]);
    
    const defenseMaterial = new THREE.LineBasicMaterial({ 
      color: 0x00BFFF,
      transparent: true,
      opacity: 0
    });
    
    const defenseLine = new THREE.Line(defenseGeom, defenseMaterial);
    this.scene.add(defenseLine);
    
    // Savunma parıltısı
    const glowGeometry = new THREE.SphereGeometry(10, 16, 16);
    const glowMaterial = new THREE.MeshBasicMaterial({ 
      color: 0x00BFFF,
      transparent: true,
      opacity: 0
    });
    
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.position.copy(targetPoint.position);
    this.scene.add(glow);
    
    // Savunma animasyonu
    let progress = 0;
    
    const animateDefense = () => {
      if (progress < 1) {
        progress += 0.03;
        defenseMaterial.opacity = Math.sin(progress * Math.PI) * 0.8;
        glowMaterial.opacity = Math.sin(progress * Math.PI) * 0.5;
        
        // Glow boyutunu değiştir
        const scale = 1 + Math.sin(progress * Math.PI) * 0.5;
        glow.scale.set(scale, scale, scale);
        
        requestAnimationFrame(animateDefense);
      } else {
        // Animasyon bitince temizle
        this.scene.remove(defenseLine);
        this.scene.remove(glow);
      }
    };
    
    animateDefense();
  }
  
  onResize() {
    this.width = this.container.offsetWidth;
    this.height = this.container.offsetHeight;
    
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    
    this.renderer.setSize(this.width, this.height);
  }
  
  animate() {
    requestAnimationFrame(this.animate.bind(this));
    
    // Dünyayı döndür
    this.globe.rotation.y += 0.001;
    this.innerGlobe.rotation.y += 0.0005;
    
    // Rastgele saldırı animasyonu
    if (Math.random() < 0.005) { // Her ~200 karede bir
      this.createAttackDefense();
    }
    
    // Noktaları pulse et
    this.points.forEach(point => {
      if (point.userData.isProtected) {
        const scale = 1 + 0.2 * Math.sin(Date.now() * 0.001 * point.userData.pulseSpeed);
        point.scale.set(scale, scale, scale);
      }
    });
    
    // Koruma noktalarını pulse et
    this.protectionPoints.forEach(point => {
      const scale = 1 + 0.3 * Math.sin(Date.now() * 0.001);
      point.scale.set(scale, scale, scale);
    });
    
    // Kamerayı çok hafif hareket ettir
    this.camera.position.x = Math.sin(Date.now() * 0.0002) * 30;
    this.camera.position.y = Math.sin(Date.now() * 0.0001) * 20;
    this.camera.lookAt(0, 0, 0);
    
    this.renderer.render(this.scene, this.camera);
  }
}

// Sayfa yüklendiğinde başlat
window.addEventListener('load', () => {
  new WorldAnimation();
});