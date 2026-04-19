"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { GitBranch, Plus, RefreshCw, Search, Users, X } from "lucide-react";
import { familyApi } from "../lib/familyApi";
import type { CreatePersonInput, CreateRelationshipInput, Gender, GraphMode, Person, RelationshipType } from "../lib/types";
import { useSearchPersonsQuery } from "../hooks/useFamilyTree";
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

interface NavbarProps {
  onRefresh: () => Promise<void>;
  persons: Person[];
  relationshipCount: number;
  onSelectPerson: (id: string) => void;
  mode: GraphMode;
  onModeChange: (mode: GraphMode) => void;
}

const inputCls =
  "w-full rounded-2xl border border-white/10 bg-slate-950/80 px-3.5 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/40 focus:bg-slate-950";

const relationshipOptions: Array<{ value: RelationshipType; label: string; group: string }> = [
  { value: "father", label: "is Father of", group: "Parent of" },
  { value: "mother", label: "is Mother of", group: "Parent of" },
  { value: "spouse", label: "is Spouse of", group: "Partner" },
  { value: "sibling", label: "is Sibling of", group: "Sibling" },
];

export default function Navbar({
  onRefresh,
  persons,
  relationshipCount,
  onSelectPerson,
  mode,
  onModeChange,
}: NavbarProps) {
  const [showPersonModal, setShowPersonModal] = useState(false);
  const [showRelModal, setShowRelModal] = useState(false);
  const [search, setSearch] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const deferredSearch = useDeferredValue(search.trim());
  const { data: searchResults = [], isFetching: isSearching } = useSearchPersonsQuery(deferredSearch);

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  const sortedPersons = useMemo(
    () => [...persons].sort((left, right) => left.name.localeCompare(right.name)),
    [persons],
  );

  const handleSelectResult = (person: Person) => {
    onSelectPerson(person.id);
    setSearch("");
    setShowResults(false);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
      toast("Workspace refreshed", "info");
    } finally {
      setRefreshing(false);
    }
  };

  const handleModeChange = (nextMode: GraphMode) => {
    if (nextMode === mode) {
      return;
    }
    startTransition(() => onModeChange(nextMode));
  };

  const initials = (name: string) =>
    name
      .split(" ")
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();

  const stats = [
    { label: "People", value: persons.length },
    { label: "Connections", value: relationshipCount },
  ];

  return (
    <>
      <nav className="relative z-40 shrink-0 border-b border-white/8 bg-slate-950/72 backdrop-blur-2xl">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-2 px-2.5 py-2 sm:px-3 xl:flex-row xl:items-center xl:justify-between xl:gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-[20px] border border-white/8 bg-white/5 px-2 py-1.5 shadow-[0_8px_24px_rgba(2,6,23,0.2)]">
              <div className="flex h-8 w-8 items-center justify-center rounded-2xl bg-cyan-500/14 text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.12)]">
                <GitBranch className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[13px] font-semibold tracking-tight text-slate-50">Family Workspace</p>
                <p className="hidden text-[10px] text-slate-400 2xl:block">Curate and inspect the tree.</p>
              </div>
            </div>
            <div className="hidden flex-wrap items-center gap-1.5 xl:flex">
              {stats.map((stat) => (
                <div key={stat.label} className="rounded-full border border-white/8 bg-white/5 px-2 py-1 text-[10px] text-slate-300">
                  <span className="mr-1.5 uppercase tracking-[0.2em] text-slate-500">{stat.label}</span>
                  <span className="font-semibold text-slate-100">{stat.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-2 xl:min-w-0 xl:flex-row xl:items-center xl:px-2">
            <div className="inline-flex shrink-0 rounded-[16px] border border-white/8 bg-white/5 p-0.5">
              <button
                type="button"
                onClick={() => handleModeChange("2d")}
                className={`rounded-[14px] px-2.5 py-1.5 text-[13px] font-medium transition ${mode === "2d" ? "bg-cyan-500/14 text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.12)]" : "text-slate-400 hover:text-slate-100"}`}
                aria-pressed={mode === "2d"}
              >
                Tree View
              </button>
              <button
                type="button"
                onClick={() => handleModeChange("3d")}
                className={`rounded-[14px] px-2.5 py-1.5 text-[13px] font-medium transition ${mode === "3d" ? "bg-violet-500/14 text-violet-100 shadow-[0_0_0_1px_rgba(168,85,247,0.14)]" : "text-slate-400 hover:text-slate-100"}`}
                aria-pressed={mode === "3d"}
              >
                3D Explore
              </button>
            </div>

            <div ref={searchRef} className="relative min-w-0 flex-1">
              <div className="relative flex items-center">
                <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-slate-500" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onFocus={() => {
                    if (search.trim()) {
                      setShowResults(true);
                    }
                  }}
                  placeholder="Search people"
                  className="h-9 w-full min-w-0 rounded-[18px] border border-white/10 bg-white/5 pl-9 pr-9 text-[13px] text-slate-100 outline-none transition placeholder:text-slate-500 hover:border-white/14 focus:border-cyan-400/35 focus:bg-slate-950/90"
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setShowResults(false);
                    }}
                    className="absolute right-2.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-500 transition hover:bg-white/8 hover:text-slate-200"
                    aria-label="Clear search"
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </div>

              {showResults && deferredSearch ? (
                <div className="dropdown-enter absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-[24px] border border-white/10 bg-slate-900/98 shadow-[0_28px_80px_rgba(2,6,23,0.65)] backdrop-blur-2xl">
                  {isSearching ? (
                    <p className="px-4 py-4 text-sm text-slate-400">Searching the family record…</p>
                  ) : searchResults.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-slate-500">No results for &ldquo;{deferredSearch}&rdquo;</p>
                  ) : (
                    <div className="max-h-80 overflow-y-auto custom-scrollbar py-1.5">
                      {searchResults.map((person) => (
                        <button
                          key={person.id}
                          type="button"
                          onClick={() => handleSelectResult(person)}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/5"
                        >
                          <div className={`flex h-10 w-10 items-center justify-center rounded-2xl text-xs font-bold ${person.gender === "male" ? "bg-cyan-500/12 text-cyan-100" : person.gender === "female" ? "bg-rose-500/12 text-rose-100" : "bg-white/8 text-slate-300"}`}>
                            {initials(person.name)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-slate-100">{person.name}</p>
                            <p className="mt-1 text-xs text-slate-500 capitalize">
                              {person.gender}
                              {person.date_of_birth ? ` · ${new Date(person.date_of_birth).getFullYear()}` : ""}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 xl:shrink-0 xl:justify-end">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[16px] border border-white/10 bg-white/5 px-3 text-[13px] font-medium text-slate-200 transition hover:border-white/14 hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "spinner" : ""}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setShowPersonModal(true)}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[16px] bg-cyan-500 px-3 text-[13px] font-semibold text-slate-950 transition hover:bg-cyan-400"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Person
            </button>
            <button
              type="button"
              onClick={() => setShowRelModal(true)}
              disabled={persons.length < 2}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[16px] bg-violet-500/85 px-3 text-[13px] font-semibold text-white transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Users className="h-3.5 w-3.5" />
              Add Link
            </button>
          </div>
        </div>
      </nav>

      {showPersonModal ? (
        <PersonModal
          onClose={() => setShowPersonModal(false)}
          onSuccess={async () => {
            setShowPersonModal(false);
            await onRefresh();
            toast("Person added", "success");
          }}
        />
      ) : null}

      {showRelModal ? (
        <RelationshipModal
          persons={sortedPersons}
          onClose={() => setShowRelModal(false)}
          onSuccess={async () => {
            setShowRelModal(false);
            await onRefresh();
            toast("Relationship added", "success");
          }}
        />
      ) : null}
    </>
  );
}

function PersonModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => Promise<void> }) {
  const [form, setForm] = useState<CreatePersonInput>({ name: "", gender: "male" });
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) {
      return;
    }

    setLoading(true);
    try {
      await familyApi.createPerson({
        ...form,
        name: form.name.trim(),
        date_of_birth: form.date_of_birth ? new Date(form.date_of_birth).toISOString() : undefined,
      });
      await onSuccess();
    } catch {
      toast("Failed to create person", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <DialogShell title="Add person" description="Create a new profile and place them into the current workspace." onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Full name">
          <input
            required
            autoFocus
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            className={inputCls}
            placeholder="Enter full name"
          />
        </Field>
        <Field label="Gender">
          <select
            value={form.gender}
            onChange={(event) => setForm((current) => ({ ...current, gender: event.target.value as Gender }))}
            className={inputCls}
          >
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Date of birth" optional>
          <input
            type="date"
            value={form.date_of_birth ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, date_of_birth: event.target.value }))}
            className={inputCls}
          />
        </Field>
        <ModalActions onClose={onClose} loading={loading} label="Create person" />
      </form>
    </DialogShell>
  );
}

function RelationshipModal({
  persons,
  onClose,
  onSuccess,
}: {
  persons: Person[];
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const [form, setForm] = useState<CreateRelationshipInput>({
    from_person_id: persons[0]?.id ?? "",
    to_person_id: persons[1]?.id ?? persons[0]?.id ?? "",
    type: "father",
  });
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const groupedOptions = relationshipOptions.reduce<Record<string, Array<{ value: RelationshipType; label: string }>>>((groups, option) => {
    groups[option.group] = [...(groups[option.group] ?? []), { value: option.value, label: option.label }];
    return groups;
  }, {});

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (form.from_person_id === form.to_person_id) {
      toast("Cannot link a person to themselves", "error");
      return;
    }

    setLoading(true);
    try {
      await familyApi.createRelationship(form);
      await onSuccess();
    } catch (error: unknown) {
      toast(getErrorMessage(error, "Failed to create relationship"), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <DialogShell title="Add relationship" description="Create a direct explicit connection. Derived links will update automatically." onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="From person">
          <select
            value={form.from_person_id}
            onChange={(event) => setForm((current) => ({ ...current, from_person_id: event.target.value }))}
            className={inputCls}
          >
            {persons.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Connection">
          <select
            value={form.type}
            onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as RelationshipType }))}
            className={inputCls}
          >
            {Object.entries(groupedOptions).map(([group, options]) => (
              <optgroup key={group} label={group}>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="To person">
          <select
            value={form.to_person_id}
            onChange={(event) => setForm((current) => ({ ...current, to_person_id: event.target.value }))}
            className={inputCls}
          >
            {persons.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </Field>
        <ModalActions onClose={onClose} loading={loading} label="Create relationship" accent="violet" />
      </form>
    </DialogShell>
  );
}

function Field({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
        {label}
        {optional ? <span className="ml-2 normal-case tracking-normal text-slate-600">optional</span> : null}
      </label>
      {children}
    </div>
  );
}

function ModalActions({
  onClose,
  loading,
  label,
  accent = "blue",
}: {
  onClose: () => void;
  loading: boolean;
  label: string;
  accent?: "blue" | "violet";
}) {
  const buttonClassName = accent === "violet"
    ? "bg-violet-500 hover:bg-violet-400 text-white"
    : "bg-cyan-500 hover:bg-cyan-400 text-slate-950";

  return (
    <div className="flex items-center justify-end gap-2 pt-1">
      <button
        type="button"
        onClick={onClose}
        className="inline-flex h-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 text-sm text-slate-300 transition hover:border-white/14 hover:bg-white/8 hover:text-white"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={loading}
        className={`inline-flex h-11 items-center justify-center rounded-2xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${buttonClassName}`}
      >
        {loading ? "Saving…" : label}
      </button>
    </div>
  );
}
