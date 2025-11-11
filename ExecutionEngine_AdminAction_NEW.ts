  /**
   * Execute ADMIN_ACTION intent - Uses BecasFlow AI Planning
   */
  private async executeAdminAction(step: ExecutionStep, context: ExecutionContext): Promise<string> {
    if (!context.message.guild) {
      return '❌ This command can only be used in a server';
    }

    // Check if user has admin permissions
    if (!context.message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
      return '❌ You need Administrator permissions to use admin commands';
    }

    try {
      // Build BecasContext for planning
      const becasContext: BecasContext = {
        guild: context.message.guild,
        channel: context.message.channel as TextChannel,
        member: context.message.member,
        message: context.message,
        services: {
          v3Integration: this.v3Integration,
          database: null,
          cache: null,
          audit: null,
        },
        // Required by BecasPlanner but not used yet
        conversationHistory: [],
        stepResults: new Map(),
        addToHistory: () => {},
        resolveReference: () => undefined,
        getStepResult: () => undefined,
        setStepResult: () => {},
      };

      logger.info(`🤖 BecasPlanner: Planning for admin action: "${step.query}"`);

      // Use BecasPlanner to create execution plan from natural language
      const planningResult = await this.becasPlanner.createPlan(step.query, becasContext);

      if (!planningResult.success || !planningResult.plan) {
        logger.error(`❌ BecasPlanner failed: ${planningResult.errors.join(', ')}`);
        return `❌ Could not create execution plan: ${planningResult.errors.join(', ')}`;
      }

      const plan = planningResult.plan;
      logger.info(`✅ BecasPlanner generated ${plan.steps.length} steps`);

      // Execute the plan using BecasExecutor
      const executionResult = await this.becasExecutor.executePlan(plan, becasContext);

      if (!executionResult.success) {
        logger.error(`❌ BecasExecutor failed: ${executionResult.errors.join(', ')}`);
        return `❌ Execution failed: ${executionResult.errors.join(', ')}`;
      }

      logger.info(`✅ BecasExecutor completed successfully`);

      // Return the final output
      return executionResult.finalOutput || '✅ Admin action completed successfully';
    } catch (error) {
      logger.error('Failed to execute admin action:', error);
      return `❌ Failed to execute admin action: ${error}`;
    }
  }
