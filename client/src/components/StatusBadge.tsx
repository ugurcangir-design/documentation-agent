import type { DocumentStatus } from "../types";

const config: Record<
  DocumentStatus,
  { label: string; className: string }
> = {
  draft: {
    label: "Taslak",
    className: "bg-gray-100 text-gray-600",
  },
  approved: {
    label: "Onaylandı",
    className: "bg-green-100 text-green-700",
  },
  published: {
    label: "Yayınlandı",
    className: "bg-blue-100 text-blue-700",
  },
};

export default function StatusBadge({
  status,
}: {
  status: DocumentStatus;
}) {
  const { label, className } = config[status];

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}
