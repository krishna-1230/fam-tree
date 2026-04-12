"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, Users, Search, X, RefreshCw, GitBranch } from "lucide-react";
import api from "../lib/api";
import { useToast } from "./Toast";

interface Person {
  id: string;
  name: string;
  gender: string;
  date_of_birth?: string;
}

interface NavbarProps {
  onRefresh: () => void;
  persons: Person[];
  onSelectPerson: (id: string) => void;
}

export default function Navbar({ onRefresh, persons, onSelectPerson }: NavbarProps) {
  const [showPersonModal, setShowPersonModal] = useState(false);
  const [showRelModal, setShowRelModal] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Person[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Debounced search
  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); setShowResults(false); return; }
    const t = setTimeout(async () => {
      try {
        const res = await api.get(`/api/persons/search?q=${encodeURIComponent(search.trim())}`);
        setSearchResults(res.data ?? []);
        setShowResults(true);
      } catch {
        setSearchResults([]);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [search]);

  // Close on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const handleSelectResult = useCallback((p: Person) => {
    onSelectPerson(p.id);
    setSearch("");
    setShowResults(false);
  }, [onSelectPerson]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  };

  const initials = (name: string) =>
    name.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase();

  return (
    <>
      <nav className="flex items-center gap-3 px-4 py-2.5 bg-slate-900/80 border-b border-slate-800 backdrop-blur-sm shrink-0 relative z-[9999]">
        {/* Brand */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center">
            <GitBranch className="w-4 h-4 text-white" />
          </div>
          <div className="hidden sm:block">
            <h1 className="text-sm font-bold text-white leading-none">Family Tree</h1>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {persons.length} {persons.length === 1 ? "person" : "people"}
            </p>
          </div>
        </div>

        {/* Search */}
        <div ref={searchRef} className="relative flex-1 min-w-0 max-w-sm mx-auto">
          <div className="relative flex items-center">
            <Search className="absolute left-3 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              onFocus={() => search.trim() && setShowResults(true)}
              placeholder="Search family members…"
              className="w-full pl-9 pr-8 py-2 bg-slate-800 border border-slate-700 hover:border-slate-600 focus:border-blue-500 rounded-xl text-sm text-white placeholder-slate-500 outline-none transition-colors"
            />
            {search && (
              <button
                onClick={() => { setSearch(""); setShowResults(false); }}
                className="absolute right-2.5 text-slate-500 hover:text-white transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {showResults && (
            <div className="dropdown-enter absolute top-full left-0 right-0 mt-1.5 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden max-h-72 overflow-y-auto custom-scrollbar" style={{ zIndex: 9999 }}>
              {searchResults.length === 0 ? (
                <p className="px-4 py-3 text-sm text-slate-500">No results for &ldquo;{search}&rdquo;</p>
              ) : (
                searchResults.map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleSelectResult(p)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-700/60 transition-colors text-left"
                  >
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 ${
                      p.gender === "male"   ? "bg-blue-900/60 text-blue-300" :
                      p.gender === "female" ? "bg-pink-900/60 text-pink-300" :
                      "bg-slate-700 text-slate-300"
                    }`}>
                      {initials(p.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{p.name}</p>
                      <p className="text-xs text-slate-500 capitalize">{p.gender}{p.date_of_birth ? ` · ${new Date(p.date_of_birth).getFullYear()}` : ""}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "spinner" : ""}`} />
          </button>
          <button
            onClick={() => setShowPersonModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-xs font-semibold transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Person
          </button>
          <button
            onClick={() => setShowRelModal(true)}
            disabled={persons.length < 2}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-xl text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Users className="w-3.5 h-3.5" /> Link
          </button>
        </div>
      </nav>

      {showPersonModal && (
        <PersonModal
          onClose={() => setShowPersonModal(false)}
          onSuccess={() => { setShowPersonModal(false); onRefresh(); toast("Person added"); }}
        />
      )}

      {showRelModal && (
        <RelationshipModal
          persons={persons}
          onClose={() => setShowRelModal(false)}
          onSuccess={() => { setShowRelModal(false); onRefresh(); toast("Relationship added"); }}
        />
      )}
    </>
  );
}

function PersonModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [name, setName] = useState("");
  const [gender, setGender] = useState("male");
  const [dob, setDob] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await api.post("/api/persons", {
        name: name.trim(),
        gender,
        date_of_birth: dob ? new Date(dob).toISOString() : undefined,
      });
      onSuccess();
    } catch {
      toast("Failed to create person", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Add Person" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Name">
          <input
            required autoFocus value={name}
            onChange={e => setName(e.target.value)}
            className={inputCls}
            placeholder="Full name…"
          />
        </Field>
        <Field label="Gender">
          <select value={gender} onChange={e => setGender(e.target.value)} className={inputCls}>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Date of Birth" optional>
          <input type="date" value={dob} onChange={e => setDob(e.target.value)} className={inputCls} />
        </Field>
        <ModalActions onClose={onClose} loading={loading} label="Add Person" />
      </form>
    </Modal>
  );
}

function RelationshipModal({ persons, onClose, onSuccess }: { persons: Person[]; onClose: () => void; onSuccess: () => void }) {
  const [from, setFrom] = useState(persons[0]?.id ?? "");
  const [to, setTo] = useState(persons[1]?.id ?? "");
  const [type, setType] = useState("father");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (from === to) { toast("Cannot link a person to themselves", "error"); return; }
    setLoading(true);
    try {
      await api.post("/api/relationships", { from_person_id: from, to_person_id: to, type });
      onSuccess();
    } catch (err: any) {
      toast(err.response?.data?.error ?? "Failed to create relationship", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Add Relationship" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="From">
          <select value={from} onChange={e => setFrom(e.target.value)} className={inputCls}>
            {persons.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Relationship">
          <select value={type} onChange={e => setType(e.target.value)} className={inputCls}>
            <optgroup label="Parent of →">
              <option value="father">is Father of</option>
              <option value="mother">is Mother of</option>
            </optgroup>
            <optgroup label="Partner">
              <option value="spouse">is Spouse of</option>
            </optgroup>
            <optgroup label="Sibling">
              <option value="sibling">is Sibling of</option>
            </optgroup>
          </select>
        </Field>
        <Field label="To">
          <select value={to} onChange={e => setTo(e.target.value)} className={inputCls}>
            {persons.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <ModalActions onClose={onClose} loading={loading} label="Add Link" accent="violet" />
      </form>
    </Modal>
  );
}

// ── Small shared UI helpers ─────────────────────────────────
const inputCls =
  "w-full bg-slate-900 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2.5 text-sm text-white outline-none transition-colors";

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-sm shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-800">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1 hover:bg-slate-800 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
        {label} {optional && <span className="normal-case text-slate-600 font-normal">(optional)</span>}
      </label>
      {children}
    </div>
  );
}

function ModalActions({ onClose, loading, label, accent = "blue" }: { onClose: () => void; loading: boolean; label: string; accent?: string }) {
  const color = accent === "violet" ? "bg-violet-600 hover:bg-violet-500" : "bg-blue-600 hover:bg-blue-500";
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors">Cancel</button>
      <button type="submit" disabled={loading} className={`px-4 py-2 text-sm font-medium text-white rounded-xl transition-colors disabled:opacity-50 ${color}`}>
        {loading ? "Saving…" : label}
      </button>
    </div>
  );
}
