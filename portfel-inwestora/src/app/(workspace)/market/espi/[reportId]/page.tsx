import EspiReportDetail from "@/components/EspiReportDetail";

export default async function EspiReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  return <EspiReportDetail reportId={reportId} />;
}

