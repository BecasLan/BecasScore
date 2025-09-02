// Ana JavaScript dosyası
document.addEventListener('DOMContentLoaded', () => {
  // Sayfa içi smooth scroll
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      e.preventDefault();
      
      const targetId = this.getAttribute('href');
      const targetElement = document.querySelector(targetId);
      
      if (targetElement) {
        window.scrollTo({
          top: targetElement.offsetTop - 80,
          behavior: 'smooth'
        });
      }
    });
  });
  
  // Sayfa kaydırma olayı - navbar renk değiştirme
  window.addEventListener('scroll', () => {
    const navbar = document.querySelector('.navbar');
    
    if (window.scrollY > 50) {
      navbar.style.background = 'rgba(21, 21, 21, 0.95)';
      navbar.style.padding = '1rem 0';
    } else {
      navbar.style.background = 'rgba(21, 21, 21, 0.8)';
      navbar.style.padding = '1.5rem 0';
    }
  });
});