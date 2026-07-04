import SwissDrawClient from "./SwissDrawClient";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const initialView = getParam(params, "view") === "participant" ? "participant" : "admin";
  const playerParam = getParam(params, "player");
  const initialPlayerId = playerParam ?? "P001";
  const initialEventCode = getParam(params, "event") ?? null;

  return (
    <SwissDrawClient
      initialEventCode={initialEventCode}
      initialPlayerId={initialPlayerId}
      initialPlayerLocked={Boolean(playerParam)}
      initialView={initialView}
    />
  );
}
