from pathlib import Path

from django.contrib import admin, messages as django_messages
from django.contrib.auth.models import User

from .models import Conversation, DocumentSummary, Message, Workspace, WorkspaceMembership


class WorkspaceMembershipInline(admin.TabularInline):
    model = WorkspaceMembership
    extra = 1
    autocomplete_fields = ['user']
    readonly_fields = ['joined_at']


@admin.register(Workspace)
class WorkspaceAdmin(admin.ModelAdmin):
    list_display = ['name', 'slug', 'member_count', 'summary_count', 'created_at']
    search_fields = ['name', 'slug']
    prepopulated_fields = {'slug': ('name',)}
    readonly_fields = ['created_at']
    inlines = [WorkspaceMembershipInline]

    @admin.display(description='Members')
    def member_count(self, obj):
        return obj.members.count()

    @admin.display(description='Summaries')
    def summary_count(self, obj):
        return obj.summaries.count()


@admin.register(WorkspaceMembership)
class WorkspaceMembershipAdmin(admin.ModelAdmin):
    list_display = ['user', 'workspace', 'joined_at']
    list_filter = ['workspace']
    search_fields = ['user__username', 'workspace__name']
    autocomplete_fields = ['user', 'workspace']
    readonly_fields = ['joined_at']


@admin.register(DocumentSummary)
class DocumentSummaryAdmin(admin.ModelAdmin):
    list_display = ['source', 'workspace', 'file_size_kb', 'generated_at']
    list_filter = ['workspace']
    search_fields = ['source']
    readonly_fields = ['generated_at', 'file_size_bytes']
    actions = ['delete_document_fully']

    @admin.display(description='Size')
    def file_size_kb(self, obj):
        return f'{obj.file_size_bytes // 1024} KB'

    @admin.action(description='Delete document fully (chunks + MinIO + summary)')
    def delete_document_fully(self, request, queryset):
        from api import services
        storage = services.get_storage()
        count = 0
        for summary in queryset:
            try:
                ws_id = summary.workspace_id
                ws_prefix = str(ws_id) if ws_id is not None else "global"
                stem = Path(summary.source).stem
                services.get_vector_store().delete(summary.source, workspace_id=ws_id)
                for key in storage.list_objects(prefix=f"originals/{ws_prefix}/"):
                    if Path(key).stem == stem:
                        try:
                            storage.delete_object(key)
                        except Exception:
                            pass
                try:
                    storage.delete_object(f"converted/{ws_prefix}/{stem}.md")
                except Exception:
                    pass
                summary.delete()
                count += 1
            except Exception as exc:
                self.message_user(request, f"Error deleting {summary.source}: {exc}", level=django_messages.ERROR)
        if count:
            self.message_user(request, f"Deleted {count} document(s) fully.")


class MessageInline(admin.TabularInline):
    model = Message
    extra = 0
    readonly_fields = ['role', 'content_preview', 'duration_ms', 'created_at']
    fields = ['role', 'content_preview', 'duration_ms', 'created_at']
    can_delete = False
    show_change_link = True
    max_num = 0

    @admin.display(description='Content')
    def content_preview(self, obj):
        return obj.content[:120] + ('…' if len(obj.content) > 120 else '')


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ['title', 'user', 'message_count', 'created_at', 'updated_at']
    list_filter = ['user']
    search_fields = ['title', 'user__username']
    readonly_fields = ['created_at', 'updated_at']
    inlines = [MessageInline]

    @admin.display(description='Messages')
    def message_count(self, obj):
        return obj.messages.count()


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ['conversation', 'role', 'content_preview', 'duration_ms', 'created_at']
    list_filter = ['role', 'conversation__user']
    search_fields = ['content', 'conversation__title']
    readonly_fields = ['created_at']

    @admin.display(description='Content')
    def content_preview(self, obj):
        return obj.content[:80] + ('…' if len(obj.content) > 80 else '')
