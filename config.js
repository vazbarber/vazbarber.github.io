// =====================================================================
//  CONFIGURAÇÃO DO SITE — único ficheiro que tens de editar no site.
//  Enquanto SUPABASE_URL estiver vazio, o site funciona em MODO DEMO
//  (dados de exemplo, nada é guardado) para poderes ver como fica.
// =====================================================================
window.APP_CONFIG = {
  // Supabase → Project Settings → API
  SUPABASE_URL: "",        // ex.: "https://abcdefgh.supabase.co"
  SUPABASE_ANON_KEY: "",   // a chave "anon" / "publishable" (é pública, pode ficar aqui)

  BUSINESS_NAME: "Vaz Barber",
  // Zona mostrada no site. A morada exata NÃO aparece no site:
  // só vai no email de confirmação (secret BUSINESS_ADDRESS no Supabase).
  AREA: "Lisboa",
  PHONE: "",               // vazio = não aparece no site
  INSTAGRAM: "_vaz_barber", // sem @; vazio = não aparece

  DAYS_AHEAD: 28,          // quantos dias mostrar para marcar (máx. 60)
};
