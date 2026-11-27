workspace "Code60" "Local browser application for orchestrating coding agents in isolated Git worktrees on macOS and Linux." {

    !identifiers hierarchical

    model {
        !include model/people-and-external.dsl
        !include model/containers.dsl
        !include model/deployment.dsl
    }

    views {
        !include views/context-and-containers.dsl
        !include views/components.dsl
        !include views/dynamic.dsl
        !include views/deployment.dsl
        !include styles.dsl
    }

}
