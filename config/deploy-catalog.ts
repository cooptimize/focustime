// DP-2: the seeded catalog of what a deployment can move, per data platform. Data, not UI logic: the screens only ever
// get these through `deploy.items` (actions/deploy-item-actions.ts). `key` is stable: a name can change here without
// touching a client's saved list or a planned deployment (which keeps the names it was planned with). A new row here
// reaches every client on its next new deployment, at the end of a list they have reordered.
export type DataPlatform = "fabric" | "azure";
export const DATA_PLATFORMS: readonly DataPlatform[] = ["fabric", "azure"];
export const PLATFORM_LABEL: Record<DataPlatform, string> = { fabric: "Fabric", azure: "Azure" };

export type CatalogItem = { key: string; name: string; /** Ticked by default. */ on: boolean };

export const DEPLOY_CATALOG: Record<DataPlatform, readonly CatalogItem[]> = {
  fabric: [
    { key: "fabric.lakehouse", name: "Lakehouse", on: false },
    { key: "fabric.lakehouse_sql", name: "Lakehouse SQL", on: false },
    { key: "fabric.warehouse_sql", name: "Warehouse SQL", on: true },
    { key: "fabric.pipelines", name: "Pipelines", on: false },
    { key: "fabric.framework_tables", name: "Framework Tables", on: true },
    { key: "fabric.notebooks", name: "Notebooks", on: false },
    { key: "fabric.semantic_models", name: "Semantic Models", on: true },
    { key: "fabric.reports", name: "Reports", on: true },
    { key: "fabric.variable_libraries", name: "Variable libraries / parameters", on: false },
  ],
  azure: [
    { key: "azure.serverless_sql", name: "Serverless SQL", on: false },
    { key: "azure.data_warehouse_sql", name: "Data Warehouse SQL", on: true },
    { key: "azure.adf_pipelines", name: "ADF Pipelines", on: false },
    { key: "azure.framework_tables", name: "Framework / watermark tables", on: false },
    { key: "azure.semantic_models", name: "Semantic Models", on: true },
    { key: "azure.reports", name: "Reports", on: true },
  ],
};
