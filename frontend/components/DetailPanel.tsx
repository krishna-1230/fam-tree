"use client";

import { useState, useEffect } from "react";
import { X, Plus, Trash2, Pencil, Check, ChevronRight, Unlink } from "lucide-react";
import api from "../lib/api";
import { useToast } from "./Toast";

interface RelatedPerson {
  id: string;
  name: string;
  gender: string;
  date_of_birth?: string;
  relationship_id: string;
}

interface PersonDetail {
  id: string;
  name: string;
  gender: string;
  date_of_birth?: string;
  parents: RelatedPerson[];
  children: RelatedPerson[];
  spouses: RelatedPerson[];
  siblings: RelatedPerson[];
}

interface Props {
  personData: PersonDetail;
  onClose: () => void;
  onRefresh: () => void;
  onDelete: () => void;
  onNavigate: (personId: string) => void;
}

const inputCls = "w-full bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-xl px-3 py-2 text-sm text-white outline-none transition-colors";
const genderColor = (g: string) =>
  g === "male"   ? "bg-blue-900/50 text-blue-400"   :
  g === "female" ? "bg-pink-900/50 text-pink-400"   :
                   "bg-slate-700   text-slate-300";
const initials = (name: string) =>
  name.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase();
const fmtDate = (s?: string) => s ? new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "Unknown";
const fmtYear = (s?: string) => s ? new Date(s).getFullYear().toString() : null;
const toIsoDate = (s?: string) => s ? s.slice(0, 10) : "";

// ── Quick-add inline form ──────────────────────────────────
function QuickAddForm({ role, personData, onComplete, onCancel }: { role: string; personData: PersonDetail; onComplete: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [gender, setGender] = useState(role === "mother" ? "female" : "male");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      const { data: np } = await api.post("/api/persons", { name: name.trim(), gender });
      const newId = np.id;
      const srcId = personData.id;

      if (role === "parent") {
        const type = gender === "female" ? "mother" : "father";
        await api.post("/api/relationships", { from_person_id: newId, to_person_id: srcId, type });
      } else if (role === "child") {
        const type = personData.gender === "female" ? "mother" : "father";
        await api.post("/api/relationships", { from_person_id: srcId, to_person_id: newId, type });
      } else if (role === "spouse") {
        await api.post("/api/relationships", { from_person_id: srcId, to_person_id: newId, type: "spouse" });
      } else if (role === "sibling") {
        await api.post("/api/relationships", { from_person_id: srcId, to_person_id: newId, type: "sibling" });
      }

      toast(`${name.trim()} added`, "success");
      onComplete();
    } catch (err: any) {
      toast(err.response?.data?.error ?? "Failed to add relative", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mb-2 p-3 bg-slate-800/50 rounded-xl border border-slate-700/50">
      <div className="flex gap-2 mb-2">
        <input
          autoFocus required placeholder="Full name…" value={name}
          onChange={e => setName(e.target.value)}
          className="flex-1 min-w-0 bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-xl px-2.5 py-1.5 text-sm text-white outline-none transition-colors"
        />
        <select
          value={gender} onChange={e => setGender(e.target.value)}
          className="bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-xl px-2 py-1.5 text-sm text-white outline-none transition-colors"
        >
          <option value="male">M</option>
          <option value="female">F</option>
          <option value="other">?</option>
        </select>
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="text-xs px-2 py-1 text-slate-500 hover:text-white transition-colors">Cancel</button>
        <button type="submit" disabled={loading} className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium transition-colors disabled:opacity-50">
          {loading ? "Saving…" : "Add"}
        </button>
      </div>
    </form>
  );
}

// ── Main component ─────────────────────────────────────────
export default function DetailPanel({ personData, onClose, onRefresh, onDelete, onNavigate }: Props) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", gender: "", dob: "" });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activeQuickAdd, setActiveQuickAdd] = useState<string | null>(null);
  const [deletingRelId, setDeletingRelId] = useState<string | null>(null);

  // Reset state when switching persons
  useEffect(() => {
    setIsEditing(false);
    setActiveQuickAdd(null);
    setEditForm({ name: personData.name, gender: personData.gender, dob: toIsoDate(personData.date_of_birth) });
  }, [personData.id]);

  const startEdit = () => {
    setEditForm({ name: personData.name, gender: personData.gender, dob: toIsoDate(personData.date_of_birth) });
    setIsEditing(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editForm.name.trim()) return;
    setSaving(true);
    try {
      await api.put(`/api/persons/${personData.id}`, {
        name: editForm.name.trim(),
        gender: editForm.gender,
        date_of_birth: editForm.dob ? new Date(editForm.dob).toISOString() : undefined,
      });
      toast("Changes saved", "success");
      setIsEditing(false);
      onRefresh();
    } catch {
      toast("Failed to save changes", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${personData.name}" and all their relationships? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.delete(`/api/persons/${personData.id}`);
      toast(`${personData.name} deleted`);
      onDelete();
    } catch {
      toast("Failed to delete person", "error");
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteRelationship = async (relId: string) => {
    if (!relId || relId === "000000000000000000000000") return;
    setDeletingRelId(relId);
    try {
      await api.delete(`/api/relationships/${relId}`);
      toast("Relationship removed");
      onRefresh();
    } catch {
      toast("Failed to remove relationship", "error");
    } finally {
      setDeletingRelId(null);
    }
  };

  const renderSection = (title: string, role: string, list: RelatedPerson[]) => {
    const isAdding = activeQuickAdd === role;
    return (
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{title}</h3>
          <button
            onClick={() => setActiveQuickAdd(isAdding ? null : role)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>

        {isAdding && (
          <QuickAddForm
            role={role} personData={personData}
            onCancel={() => setActiveQuickAdd(null)}
            onComplete={() => { setActiveQuickAdd(null); onRefresh(); }}
          />
        )}

        {(!list || list.length === 0) && !isAdding && (
          <p className="text-xs text-slate-600 italic px-1">None</p>
        )}

        <div className="flex flex-col gap-1">
          {list?.map(p => (
            <div
              key={p.relationship_id || p.id}
              onClick={() => onNavigate(p.id)}
              className="group flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-800/30 hover:bg-slate-800 border border-transparent hover:border-slate-700/50 cursor-pointer transition-all"
            >
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold shrink-0 ${genderColor(p.gender)}`}>
                {initials(p.name)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200 truncate">{p.name}</p>
                {fmtYear(p.date_of_birth) && (
                  <p className="text-[11px] text-slate-600">{fmtYear(p.date_of_birth)}</p>
                )}
              </div>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                {p.relationship_id && p.relationship_id !== "000000000000000000000000" && (
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteRelationship(p.relationship_id); }}
                    disabled={deletingRelId === p.relationship_id}
                    className="p-1 text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-40"
                    title="Remove relationship"
                  >
                    <Unlink className="w-3 h-3" />
                  </button>
                )}
                <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="panel-enter w-80 bg-slate-900 border-l border-slate-800 h-full flex flex-col shrink-0 shadow-2xl">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-slate-800 shrink-0">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${genderColor(personData.gender)}`}>
              {initials(personData.name)}
            </div>
            {isEditing ? (
              <form onSubmit={handleSaveEdit} className="flex-1 min-w-0">
                <input
                  autoFocus value={editForm.name}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full bg-slate-950 border border-blue-500 rounded-xl px-2.5 py-1.5 text-sm text-white outline-none mb-1.5"
                />
                <div className="flex gap-1.5 mb-1.5">
                  <select
                    value={editForm.gender}
                    onChange={e => setEditForm(f => ({ ...f, gender: e.target.value }))}
                    className="flex-1 bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-xl px-2 py-1.5 text-xs text-white outline-none"
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                  <input
                    type="date" value={editForm.dob}
                    onChange={e => setEditForm(f => ({ ...f, dob: e.target.value }))}
                    className="flex-1 bg-slate-950 border border-slate-700 focus:border-blue-500 rounded-xl px-2 py-1.5 text-xs text-white outline-none"
                  />
                </div>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => setIsEditing(false)} className="flex-1 text-xs py-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">Cancel</button>
                  <button type="submit" disabled={saving} className="flex-1 text-xs py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1">
                    <Check className="w-3 h-3" />{saving ? "Saving…" : "Save"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="min-w-0">
                <h2 className="font-bold text-white leading-tight truncate">{personData.name}</h2>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={`text-[10px] font-semibold capitalize px-2 py-0.5 rounded-md ${genderColor(personData.gender)}`}>
                    {personData.gender}
                  </span>
                  {personData.date_of_birth && (
                    <span className="text-[10px] text-slate-500">b. {fmtDate(personData.date_of_birth)}</span>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-0.5 ml-1 shrink-0">
            {!isEditing && (
              <button onClick={startEdit} className="p-1.5 text-slate-500 hover:text-white hover:bg-slate-800 rounded-xl transition-colors" title="Edit">
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-white hover:bg-slate-800 rounded-xl transition-colors" title="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Relationship Sections */}
      <div className="flex-1 overflow-y-auto px-4 py-4 custom-scrollbar">
        {renderSection("Parents",  "parent",  personData.parents  ?? [])}
        {renderSection("Spouses",  "spouse",  personData.spouses  ?? [])}
        {renderSection("Children", "child",   personData.children ?? [])}
        {renderSection("Siblings", "sibling", personData.siblings ?? [])}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-slate-800 shrink-0">
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="flex items-center gap-2 px-3 py-2 w-full rounded-xl text-xs font-medium text-red-500 hover:bg-red-900/20 hover:text-red-400 border border-transparent hover:border-red-900/30 transition-all disabled:opacity-50"
        >
          <Trash2 className="w-3.5 h-3.5" />
          {deleting ? "Deleting…" : `Delete ${personData.name}`}
        </button>
      </div>
    </div>
  );
}
