import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

/** Ends the session from anywhere on the site, then returns to the home page. */
export function useSignOut() {
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const signOut = async () => {
    if (!supabase || isSigningOut) return;
    setIsSigningOut(true);
    try {
      await supabase.auth.signOut();
      navigate("/", { replace: true });
    } finally {
      setIsSigningOut(false);
    }
  };

  return { signOut, isSigningOut };
}
