import type { Metadata } from "next";
import { PageShell, Prose, Callout } from "@/components/layout/PageShell";
import { ToolBuilder } from "@/components/tool-builder/ToolBuilder";
import { TEMPLATES } from "@/lib/tool-builder/templates";
import { clampDescription } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Tool builder (experimental)",
  description: clampDescription(
    "Describe a utility in plain English and get a working tool with your options preset. Experimental: it matches existing tools and never generates or runs code.",
  ),
  alternates: { canonical: "/tool-builder" },
  robots: { index: true, follow: true },
};

export default function ToolBuilderPage() {
  return (
    <PageShell
      title="Tool builder"
      description="Describe a utility. Get a working tool with your options already set."
      eyebrow="Experimental"
      className="max-w-3xl"
    >
      <Callout tone="warning" title="This is an experimental feature.">
        It may match the wrong tool, and its catalogue is limited to what already exists. It is a
        demonstration of the approach, not a finished product.
      </Callout>

      <div className="mt-6">
        <ToolBuilder />
      </div>

      <Prose>
        <h2>How it is kept safe</h2>
        <p>
          Language models that write and then run code are a genuinely bad idea to ship to the
          public, so this one does not. There is no code generation step at all. The system does one
          of two things:
        </p>
        <ol>
          <li>
            matches your words against a fixed list of {TEMPLATES.length} hand-written, tested
            tools, or
          </li>
          <li>
            asks a model to pick one id from that same list, then{" "}
            <strong>validates the answer against the list before using it</strong>.
          </li>
        </ol>
        <p>
          There is no <code className="font-mono text-[13px]">eval</code>, no{" "}
          <code className="font-mono text-[13px]">new Function</code>, no dynamic{" "}
          <code className="font-mono text-[13px]">import()</code> of a generated path, and no
          template literal that reaches an interpreter. A confused or adversarial model response can
          at worst select the wrong tool — it cannot execute anything, and it cannot reach an
          environment variable, because the code that would do either does not exist.
        </p>

        <h2>Why not just generate the tool?</h2>
        <p>
          Because the failure mode is unacceptable. Generated code runs with the same privileges as
          our own: it can read <code className="font-mono text-[13px]">process.env</code>, make
          arbitrary network requests, and run in a visitor&apos;s browser indefinitely. Even
          &ldquo;review the code before running it&rdquo; is not a control users reliably apply, and
          the review itself needs a sandbox to be meaningful.
        </p>
        <p>
          Mapping onto reviewed components gives up some ambition and keeps the guarantee. That is
          the right trade for a public tool.
        </p>
      </Prose>
    </PageShell>
  );
}
