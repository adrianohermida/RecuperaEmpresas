// debug-auth-session.js
// Cole este script no console do navegador na página de login ou dashboard
(function() {
  function printSection(title) {
    console.log(`\n==== ${title} ====`);
  }

  printSection('Cookies');
  document.cookie.split(';').forEach(c => {
    const [k, v] = c.split('=');
    console.log(`${k.trim()}: ${decodeURIComponent(v||'')}`);
  });

  printSection('localStorage');
  Object.keys(localStorage).forEach(k => {
    console.log(`${k}:`, localStorage.getItem(k));
  });

  printSection('Supabase Session');
  try {
    const sbToken = localStorage.getItem('supabase.auth.token');
    if (sbToken) {
      const parsed = JSON.parse(sbToken);
      console.log('supabase.auth.token:', parsed);
    } else {
      console.warn('supabase.auth.token não encontrado');
    }
  } catch (e) {
    console.error('Erro ao ler supabase.auth.token:', e);
  }

  printSection('re_session Cookie');
  const reSession = document.cookie.split(';').find(c => c.trim().startsWith('re_session='));
  if (reSession) {
    console.log('re_session:', decodeURIComponent(reSession.split('=')[1]));
  } else {
    console.warn('Cookie re_session não encontrado');
  }
})();
