import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { registerForPushNotifications } from '../lib/pushNotifications';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState(null);

  // Sessionen finns både som state (för renderingen) och i en ref (för att
  // kunna läsas inifrån en funktion som skapades innan inloggningen hann bli
  // klar). Utan ref:en läste reloadProfile ett gammalt session=null och blev
  // en tyst no-op — se kommentaren vid reloadProfile.
  const sessionRef = useRef(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return;
      setSession(session);
      if (session) loadProfile(session.user.id);
      else setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) loadProfile(session.user.id);
      else {
        setProfile(null);
        setProfileError(null);
        setLoading(false);
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // Läser profilen. Tre utfall, och de måste hållas isär:
  //  1. profilen finns            -> in i appen
  //  2. förfrågan misslyckades    -> visa fel, inte inloggningsrutan igen
  //  3. ingen profil finns        -> användaren ska skapa familj eller gå med
  // Förut såg 2 och 3 likadana ut: man matades tillbaka till inloggningen
  // utan förklaring, och kom aldrig vidare.
  async function loadProfile(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      setProfileError('Kunde inte hämta din profil. Kontrollera anslutningen och försök igen.');
      setProfile(null);
      setLoading(false);
      return;
    }

    setProfileError(null);
    setProfile(data);
    setLoading(false);

    if (data) {
      registerForPushNotifications(data.id)
        .then((result) => {
          if (!result.ok) console.warn('Push-notiser är inte på:', result.reason, result.message || '');
        })
        .catch((e) => console.warn('Kunde inte registrera push:', e?.message || e));
    }
  }

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }

  // Skapar ett konto och en helt ny familj. Den som gör det blir förälder
  // och får en inbjudningskod att dela med barn och eventuell medförälder.
  async function signUpAndCreateFamily({ email, password, displayName, familyName }) {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error };

    if (!data.session) {
      return {
        needsEmailConfirmation: true,
        error: {
          message:
            'Kontot är skapat. Öppna mejlet vi skickade och bekräfta adressen, logga sedan in här — då får du skapa din familj.',
        },
      };
    }

    const { data: family, error: rpcError } = await supabase.rpc('create_family_and_profile', {
      p_display_name: displayName,
      p_family_name: familyName,
    });
    if (rpcError) return { error: rpcError };

    // Profilen laddas medvetet inte här: skärmen visar inbjudningskoden
    // först, och hämtar profilen när man trycker "Fortsätt".
    return { family };
  }

  // Går med i en befintlig familj med hjälp av inbjudningskoden.
  async function signUpAndJoinFamily({ email, password, displayName, code, role }) {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error };

    if (!data.session) {
      return {
        needsEmailConfirmation: true,
        error: {
          message:
            'Kontot är skapat. Öppna mejlet vi skickade och bekräfta adressen, logga sedan in här — då får du ange koden igen.',
        },
      };
    }

    const { data: family, error: rpcError } = await supabase.rpc('join_family_with_code', {
      p_code: code,
      p_display_name: displayName,
      p_role: role,
    });
    if (rpcError) return { error: rpcError };

    return { family };
  }

  // För en inloggad användare som ännu inte har någon familj — t.ex. när
  // kontot skapades men e-postbekräftelsen kom emellan.
  //
  // Här laddas profilen medvetet INTE: då hade appen bytt skärm direkt och
  // inbjudningskoden hade aldrig visats. Skärmen visar koden och hämtar
  // profilen när man trycker "Fortsätt" — samma väg som vid nyregistrering.
  async function completeSignupCreateFamily({ displayName, familyName }) {
    const { data: family, error } = await supabase.rpc('create_family_and_profile', {
      p_display_name: displayName,
      p_family_name: familyName,
    });
    if (error) return { error };
    return { family };
  }

  async function completeSignupJoinFamily({ displayName, code, role }) {
    const { data: family, error } = await supabase.rpc('join_family_with_code', {
      p_code: code,
      p_display_name: displayName,
      p_role: role,
    });
    if (error) return { error };
    await reloadProfile();
    return { family };
  }

  // Sessionen läses ur ref:en och inte ur state. Den som trycker "Gå med"
  // skickar iväg ett anrop som skaparen av skärmen skapade medan sessionen
  // ännu var null; när svaret kom tillbaka läste den ett session=null och
  // gjorde ingenting. Kontot och familjen blev rätt i databasen, men appen
  // stod kvar på "Gå med"-formuläret ända till man loggade ut och in igen.
  async function reloadProfile() {
    const current = sessionRef.current;
    if (current) await loadProfile(current.user.id);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        loading,
        profileError,
        signIn,
        signOut,
        reloadProfile,
        signUpAndCreateFamily,
        signUpAndJoinFamily,
        completeSignupCreateFamily,
        completeSignupJoinFamily,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
