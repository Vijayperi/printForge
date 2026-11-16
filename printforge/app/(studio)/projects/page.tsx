import { redirect } from "next/navigation"

import {
  archiveProjectAction,
  createProjectAction,
  renameProjectAction,
} from "@/app/(studio)/projects/actions"
import { getAuthGateway } from "@/src/adapters/auth/factory"
import { PageHeader } from "@/src/components/layout/primitives"
import { CreateProjectDialog } from "@/src/components/projects/create-project-dialog"
import { ProjectCard } from "@/src/components/projects/project-card"
import { listProjectsByUser } from "@/src/data/projects"
import { getRequestDb } from "@/src/data/supabaseClients"

export default async function ProjectsPage() {
  const gateway = await getAuthGateway()
  const user = await gateway.getUser()
  if (!user.ok || user.value === null) redirect("/login")

  const db = await getRequestDb()
  const result = await listProjectsByUser(db, user.value.userId)
  const projects = result.ok ? result.value : []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="My projects"
          description="Each project is one design journey — describe it, preview it, and order it."
        />
        <CreateProjectDialog action={createProjectAction} />
      </div>

      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          <p className="font-medium text-foreground">No projects yet</p>
          <p className="mt-1 text-sm">
            Create your first project to start turning an idea into a printed object.
          </p>
        </div>
      ) : (
        <ul className="grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <li key={project.id}>
              <ProjectCard
                project={project}
                renameAction={renameProjectAction}
                archiveAction={archiveProjectAction}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
