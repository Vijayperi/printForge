import { notFound, redirect } from "next/navigation"

import { getAuthGateway } from "@/src/adapters/auth/factory"
import { CreatorWorkspace } from "@/src/components/studio/creator-workspace"
import { listDesignVersionsByProject } from "@/src/data/designVersions"
import { getProjectOwned } from "@/src/data/projects"
import { getRequestDb } from "@/src/data/supabaseClients"

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params

  const gateway = await getAuthGateway()
  const user = await gateway.getUser()
  if (!user.ok || user.value === null) redirect("/login")

  const db = await getRequestDb()
  const project = await getProjectOwned(db, user.value.userId, projectId)
  if (!project.ok || project.value === null) notFound()

  const versions = await listDesignVersionsByProject(db, projectId)

  return <CreatorWorkspace project={project.value} versions={versions.ok ? versions.value : []} />
}
