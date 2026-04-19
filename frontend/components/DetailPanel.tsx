"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Pencil, Plus, Trash2, Unlink, X } from "lucide-react";
import { familyApi } from "../lib/familyApi";
import type { Gender, PersonDetail, RelatedPerson } from "../lib/types";
import DialogShell from "./DialogShell";
import { useToast } from "./Toast";

function getErrorMessage(error: unknown, fallback: string) {
  if (
    error &&
    typeof error === "object" &&
    "response" in error &&
    error.response &&
    typeof error.response === "object" &&
    "data" in error.response &&
    error.response.data &&
    typeof error.response.data === "object" &&
    "error" in error.response.data &&
    typeof error.response.data.error === "string"
  ) {
    return error.response.data.error;
  }

  return fallback;
}

interface Props {
  personData: PersonDetail;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onDelete: () => Promise<void>;
  onNavigate: (personId: string) => void;
}

const inputCls = "w-full rounded-2xl border border-white/10 bg-slate-950/90 px-3.5 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/35";

const genderColor = (gender: Gender) =>
  gender === "male"
    ? "bg-cyan-500/12 text-cyan-100"
    : gender === "female"
      ? "bg-rose-500/12 text-rose-100"
      : "bg-white/8 text-slate-300";

const relationshipTone = (type: string) =>
  type === "father"
    ? "bg-cyan-500/10 text-cyan-100"
    : type === "mother"
      ? "bg-rose-500/10 text-rose-100"
      : type === "spouse"
        ? "bg-violet-500/10 text-violet-100"
        : "bg-amber-500/10 text-amber-100";

const initials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

const formatDate = (value?: string) =>
  value ? new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "Unknown";

const formatYear = (value?: string) => (value ? new Date(value).getFullYear().toString() : null);
const toIsoDate = (value?: string) => (value ? value.slice(0, 10) : "");

function QuickAddForm({
  role,
  personData,
  onComplete,
  onCancel,
}: {
  role: string;
  personData: PersonDetail;
  onComplete: () => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender>(role === "mother" ? "female" : "male");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }

    setLoading(true);
    try {
      const created = await familyApi.createPerson({ name: name.trim(), gender });
      const newId = created.id;
      const sourceId = personData.id;

      if (role === "parent") {
        await familyApi.createRelationship({
          from_person_id: newId,
          to_person_id: sourceId,
          type: gender === "female" ? "mother" : "father",
        });
      } else if (role === "child") {
        await familyApi.createRelationship({
          from_person_id: sourceId,
          to_person_id: newId,
          type: personData.gender === "female" ? "mother" : "father",
        });
      } else if (role === "spouse") {
        await familyApi.createRelationship({ from_person_id: sourceId, to_person_id: newId, type: "spouse" });
      } else if (role === "sibling") {
        await familyApi.createRelationship({ from_person_id: sourceId, to_person_id: newId, type: "sibling" });
      }

      toast(`${name.trim()} added`, "success");
      await onComplete();
    } catch (error: unknown) {
      toast(getErrorMessage(error, "Failed to add relative"), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-[24px] border border-white/8 bg-white/5 p-4">
      <div className="mb-3 flex gap-2">
        <input
          autoFocus
          required
          placeholder="Full name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={`${inputCls} flex-1`}
        />
        <select
          value={gender}
          onChange={(event) => setGender(event.target.value as Gender)}
          className="rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-3 text-sm text-slate-100 outline-none"
        >
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-2xl border border-white/8 bg-white/5 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/8">
          Cancel
        </button>
        <button type="submit" disabled={loading} className="rounded-2xl bg-cyan-500 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50">
          {loading ? "Saving…" : "Add"}
        </button>
      </div>
    </form>
  );
}

export default function DetailPanel({ personData, onClose, onRefresh, onDelete, onNavigate }: Props) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activeQuickAdd, setActiveQuickAdd] = useState<string | null>(null);
  const [deletingRelId, setDeletingRelId] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", gender: "male" as Gender, dob: "" });

  useEffect(() => {
    setIsEditing(false);
    setActiveQuickAdd(null);
    setConfirmDeleteOpen(false);
    setEditForm({
      name: personData.name,
      gender: personData.gender,
      dob: toIsoDate(personData.date_of_birth),
    });
  }, [personData]);

  const counts = useMemo(
    () => [
      { label: "Parents", value: personData.parents.length },
      { label: "Children", value: personData.children.length },
      { label: "Spouses", value: personData.spouses.length },
      { label: "Siblings", value: personData.siblings.length },
    ],
    [personData.children.length, personData.parents.length, personData.siblings.length, personData.spouses.length],
  );

  const handleSaveEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editForm.name.trim()) {
      return;
    }

    setSaving(true);
    try {
      await familyApi.updatePerson(personData.id, {
        name: editForm.name.trim(),
        gender: editForm.gender,
        date_of_birth: editForm.dob ? new Date(editForm.dob).toISOString() : undefined,
      });
      toast("Changes saved", "success");
      setIsEditing(false);
      await onRefresh();
    } catch {
      toast("Failed to save changes", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await familyApi.deletePerson(personData.id);
      toast(`${personData.name} deleted`, "success");
      setConfirmDeleteOpen(false);
      await onDelete();
    } catch {
      toast("Failed to delete person", "error");
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteRelationship = async (person: RelatedPerson) => {
    if (!person.relationship_id || person.relationship_source === "inferred") {
      return;
    }

    setDeletingRelId(person.relationship_id);
    try {
      await familyApi.deleteRelationship(person.relationship_id);
      toast("Relationship removed", "success");
      await onRefresh();
    } catch (error: unknown) {
      toast(getErrorMessage(error, "Failed to remove relationship"), "error");
    } finally {
      setDeletingRelId(null);
    }
  };

  const renderSection = (title: string, role: string, list: RelatedPerson[]) => {
    const isAdding = activeQuickAdd === role;

    return (
      <section className="space-y-3 rounded-[28px] border border-white/8 bg-white/[0.035] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">{title}</p>
            <p className="mt-1 text-xs text-slate-500">{list.length === 0 ? "No recorded links yet" : `${list.length} visible relationship${list.length === 1 ? "" : "s"}`}</p>
          </div>
          <button
            type="button"
            onClick={() => setActiveQuickAdd(isAdding ? null : role)}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-white/14 hover:bg-white/8"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>

        {isAdding ? (
          <QuickAddForm
            role={role}
            personData={personData}
            onCancel={() => setActiveQuickAdd(null)}
            onComplete={async () => {
              setActiveQuickAdd(null);
              await onRefresh();
            }}
          />
        ) : null}

        {list.length === 0 && !isAdding ? <p className="rounded-2xl border border-dashed border-white/8 px-4 py-3 text-sm text-slate-500">No entries yet.</p> : null}

        <div className="space-y-2">
          {list.map((person) => {
            const isDerived = person.relationship_source === "inferred";
            return (
              <div
                key={person.relationship_id || person.id}
                onClick={() => onNavigate(person.id)}
                className="group flex cursor-pointer items-center gap-3 rounded-[22px] border border-transparent bg-slate-900/45 px-3 py-3 transition hover:border-white/10 hover:bg-slate-900/72"
              >
                <div className={`flex h-10 w-10 items-center justify-center rounded-2xl text-sm font-bold ${genderColor(person.gender)}`}>
                  {initials(person.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-100">{person.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {person.relationship_type ? (
                      <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${relationshipTone(person.relationship_type)}`}>
                        {person.relationship_type}
                      </span>
                    ) : null}
                    {isDerived ? (
                      <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-100">
                        Derived
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-100">
                        Explicit
                      </span>
                    )}
                    {formatYear(person.date_of_birth) ? <span className="text-xs text-slate-500">{formatYear(person.date_of_birth)}</span> : null}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                  {!isDerived ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDeleteRelationship(person);
                      }}
                      disabled={deletingRelId === person.relationship_id}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"
                      title="Remove explicit relationship"
                    >
                      <Unlink className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  <ChevronRight className="h-4 w-4 text-slate-600" />
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  return (
    <>
      <aside className="panel-enter h-full w-[360px] shrink-0 border-l border-white/8 bg-slate-950/84 shadow-[0_24px_80px_rgba(2,6,23,0.45)] backdrop-blur-2xl xl:w-[390px]">
        <div className="flex h-full flex-col">
          <div className="border-b border-white/8 px-5 pb-5 pt-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className={`flex h-14 w-14 items-center justify-center rounded-[22px] text-base font-bold ${genderColor(personData.gender)}`}>
                  {initials(personData.name)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xl font-semibold tracking-tight text-slate-50">{personData.name}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${genderColor(personData.gender)}`}>
                      {personData.gender}
                    </span>
                    {personData.date_of_birth ? <span className="text-xs text-slate-400">Born {formatDate(personData.date_of_birth)}</span> : null}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {!isEditing ? (
                  <button type="button" onClick={() => setIsEditing(true)} className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/8 bg-white/5 text-slate-300 transition hover:bg-white/8 hover:text-white" title="Edit person">
                    <Pencil className="h-4 w-4" />
                  </button>
                ) : null}
                <button type="button" onClick={onClose} className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/8 bg-white/5 text-slate-300 transition hover:bg-white/8 hover:text-white" title="Close panel">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {isEditing ? (
              <form onSubmit={handleSaveEdit} className="space-y-3 rounded-[24px] border border-cyan-400/18 bg-cyan-500/[0.04] p-4">
                <input
                  autoFocus
                  value={editForm.name}
                  onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))}
                  className={inputCls}
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={editForm.gender}
                    onChange={(event) => setEditForm((current) => ({ ...current, gender: event.target.value as Gender }))}
                    className={inputCls}
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                  <input
                    type="date"
                    value={editForm.dob}
                    onChange={(event) => setEditForm((current) => ({ ...current, dob: event.target.value }))}
                    className={inputCls}
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button type="button" onClick={() => setIsEditing(false)} className="rounded-2xl border border-white/8 bg-white/5 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/8">
                    Cancel
                  </button>
                  <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50">
                    <Check className="h-4 w-4" />
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </form>
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-2">
              {counts.map((item) => (
                <div key={item.label} className="rounded-[20px] border border-white/8 bg-white/5 px-3 py-3">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">{item.label}</p>
                  <p className="mt-2 text-xl font-semibold text-slate-50">{item.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto px-5 py-5">
            {renderSection("Parents", "parent", personData.parents ?? [])}
            {renderSection("Spouses", "spouse", personData.spouses ?? [])}
            {renderSection("Children", "child", personData.children ?? [])}
            {renderSection("Siblings", "sibling", personData.siblings ?? [])}
          </div>

          <div className="border-t border-white/8 px-5 py-4">
            <button type="button" onClick={() => setConfirmDeleteOpen(true)} disabled={deleting} className="inline-flex w-full items-center justify-center gap-2 rounded-[20px] border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200 transition hover:bg-red-500/14 disabled:opacity-50">
              <Trash2 className="h-4 w-4" />
              Delete person
            </button>
          </div>
        </div>
      </aside>

      {confirmDeleteOpen ? (
        <DialogShell
          title={`Delete ${personData.name}?`}
          description="This removes the person and rebuilds the graph from the remaining explicit relationships. This cannot be undone."
          onClose={() => setConfirmDeleteOpen(false)}
          maxWidthClassName="max-w-lg"
        >
          <div className="space-y-5">
            <div className="rounded-[24px] border border-red-500/18 bg-red-500/[0.05] p-4 text-sm leading-6 text-slate-300">
              <p className="font-medium text-slate-100">Before continuing</p>
              <p className="mt-2">Explicit links involving this person are removed. Any derived links will be recalculated from what remains.</p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => setConfirmDeleteOpen(false)} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/8">
                Cancel
              </button>
              <button type="button" onClick={() => void handleDelete()} disabled={deleting} className="rounded-2xl bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-400 disabled:opacity-50">
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </DialogShell>
      ) : null}
    </>
  );
}
