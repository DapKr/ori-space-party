// App settings shared by all pages.
export const config = {
  // Supabase project (from Supabase → Project Settings → API). The anon/publishable key is meant
  // to be public: the database rules in supabase-setup.sql decide what it can do.
  // Leave both empty to run in local test mode (everything stays in this browser).
  supabaseUrl: '',
  supabaseKey: '',

  // Leave empty to use "upload.html" next to the show page.
  uploadUrl: '',

  // Starting values for the host settings (the host page can change them during the party).
  defaults: {
    title: 'יום הולדת שמח אורי! 🚀',
    spotlight: true,   // zoom in on a random kid every ~20 seconds
    cut: true,         // remove the background from new photos
  },
};

config.backend = config.supabaseUrl && config.supabaseKey ? 'supabase' : 'local';
