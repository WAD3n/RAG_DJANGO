from rest_framework import serializers

from .models import Workspace, WorkspaceMembership


class WorkspaceSerializer(serializers.ModelSerializer):
    member_count = serializers.SerializerMethodField()

    class Meta:
        model = Workspace
        fields = ['id', 'name', 'slug', 'created_at', 'member_count']

    def get_member_count(self, obj):
        return obj.members.count()


class WorkspaceMemberSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)
    user_id = serializers.IntegerField(source='user.id', read_only=True)

    class Meta:
        model = WorkspaceMembership
        fields = ['user_id', 'username', 'joined_at']


class ConvertRequestSerializer(serializers.Serializer):
    file_path = serializers.CharField(required=False, default=None)
    object_name = serializers.CharField(required=False, default=None)
    query = serializers.CharField(required=False, allow_blank=True, default=None)

    def validate(self, data):
        if not data.get("file_path") and not data.get("object_name"):
            raise serializers.ValidationError(
                "Provide either 'file_path' (local path) or 'object_name' (MinIO key)."
            )
        return data


class IngestRequestSerializer(serializers.Serializer):
    minio_key = serializers.CharField()


class QueryRequestSerializer(serializers.Serializer):
    question = serializers.CharField()
    top_k = serializers.IntegerField(required=False, min_value=1, max_value=20, default=None)
    model = serializers.CharField(required=False, default=None, allow_null=True)
    workspace_id = serializers.IntegerField(required=False, default=None, allow_null=True)
