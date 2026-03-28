"use client";

export type AppSection = "portfolio" | "charts";

type AppSectionTabsProps = {
  activeSection: AppSection;
  onChange: (section: AppSection) => void;
};

const SECTION_OPTIONS: Array<{
  value: AppSection;
  label: string;
}> = [
  { value: "portfolio", label: "Portfel" },
  { value: "charts", label: "Wykresy" },
];

export default function AppSectionTabs({
  activeSection,
  onChange,
}: AppSectionTabsProps) {
  return (
    <nav className="section-tabs" aria-label="Sekcje aplikacji">
      {SECTION_OPTIONS.map((section) => (
        <button
          key={section.value}
          type="button"
          className={
            activeSection === section.value
              ? "section-tab is-active"
              : "section-tab"
          }
          onClick={() => onChange(section.value)}
        >
          {section.label}
        </button>
      ))}
    </nav>
  );
}
