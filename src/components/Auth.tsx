"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { User } from "@supabase/supabase-js";
import {
  LogIn,
  LogOut,
  User as UserIcon,
  X,
  Mail,
  Github,
  Chrome,
} from "lucide-react";

export default function Auth() {
  const [user, setUser] = useState<User | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) setIsOpen(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) setMessage({ type: "error", text: error.message });
    else
      setMessage({
        type: "success",
        text: "Check your email for the login link!",
      });
    setIsLoading(false);
  };

  const handleSignInWithOAuth = async (provider: "github" | "google") => {
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  if (user) {
    return (
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full border border-zinc-200 dark:border-zinc-700">
          <div className="w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center text-[10px] text-white font-bold uppercase">
            {user.email?.[0]}
          </div>
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300 max-w-[120px] truncate">
            {user.email}
          </span>
        </div>
        <button
          onClick={handleLogout}
          className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors text-zinc-500 hover:text-red-500"
          title="Logout"
        >
          <LogOut size={18} />
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-all shadow-md hover:shadow-lg active:scale-95"
      >
        <LogIn size={18} />
        <span>Sign In</span>
      </button>

      {mounted && isOpen && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative bg-white dark:bg-zinc-900 w-full max-w-md p-8 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setIsOpen(false)}
              className="absolute top-4 right-4 p-2 hover:bg-zinc-100 dark:bg-zinc-800/50 dark:hover:bg-zinc-800 rounded-full transition-colors text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
            >
              <X size={20} />
            </button>

            <div className="text-center mb-8 mt-2">
              <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-500/10 ring-1 ring-indigo-100 dark:ring-indigo-500/20 rounded-2xl flex items-center justify-center mx-auto mb-5 text-indigo-600 dark:text-indigo-400 shadow-inner">
                <UserIcon size={32} />
              </div>
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">
                Welcome Back
              </h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2">
                Enter your email below to receive a magic link to sign in.
              </p>
            </div>

            {/* <div className="grid grid-cols-2 gap-3 mb-6">
              <button 
                onClick={() => handleSignInWithOAuth('github')}
                className="flex items-center justify-center gap-2 py-2.5 px-4 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-lg hover:opacity-90 transition-opacity font-medium"
              >
                <Github size={18} />
                GitHub
              </button>
              <button 
                onClick={() => handleSignInWithOAuth('google')}
                className="flex items-center justify-center gap-2 py-2.5 px-4 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors font-medium shadow-sm"
              >
                <Chrome size={18} />
                Google
              </button>
            </div> */}

            {/* <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-zinc-200 dark:border-zinc-800"></div>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white dark:bg-zinc-900 px-2 text-zinc-500 font-medium tracking-wider">
                  Or continue with email
                </span>
              </div>
            </div> */}

            <form onSubmit={handleEmailLogin} className="space-y-4">
              <div className="space-y-1.5">
                <div className="relative">
                  <Mail
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
                    size={18}
                  />
                  <input
                    type="email"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all dark:text-white"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? "Sending Link..." : "Send Magic Link"}
              </button>
            </form>

            {message && (
              <div
                className={`mt-6 p-4 rounded-lg text-sm font-medium animate-in slide-in-from-top-2 duration-300 ${message.type === "success" ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/40" : "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900/40"}`}
              >
                {message.text}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
