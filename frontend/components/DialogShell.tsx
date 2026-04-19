"use client";

import { useEffect, useId } from "react";
import { X } from "lucide-react";

interface DialogShellProps {
	title: string;
	description?: string;
	onClose: () => void;
	children: React.ReactNode;
	maxWidthClassName?: string;
	footer?: React.ReactNode;
}

export default function DialogShell({
	title,
	description,
	onClose,
	children,
	maxWidthClassName = "max-w-md",
	footer,
}: DialogShellProps) {
	const titleId = useId();
	const descriptionId = useId();

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				onClose();
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [onClose]);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/72 backdrop-blur-md p-4" onClick={onClose}>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={description ? descriptionId : undefined}
				className={`w-full ${maxWidthClassName} overflow-hidden rounded-[28px] border border-white/10 bg-slate-900/96 shadow-[0_40px_120px_rgba(2,6,23,0.75)]`}
				onClick={(event) => event.stopPropagation()}
			>
				<div className="flex items-start justify-between gap-4 border-b border-white/8 px-6 py-5">
					<div className="min-w-0">
						<h2 id={titleId} className="text-lg font-semibold tracking-tight text-slate-50">
							{title}
						</h2>
						{description ? (
							<p id={descriptionId} className="mt-1.5 text-sm leading-6 text-slate-400">
								{description}
							</p>
						) : null}
					</div>
					<button
						type="button"
						onClick={onClose}
						className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-white/8 bg-white/5 text-slate-400 transition hover:border-white/15 hover:bg-white/10 hover:text-slate-100"
						aria-label="Close dialog"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
				<div className="px-6 py-5">{children}</div>
				{footer ? <div className="border-t border-white/8 px-6 py-4">{footer}</div> : null}
			</div>
		</div>
	);
}