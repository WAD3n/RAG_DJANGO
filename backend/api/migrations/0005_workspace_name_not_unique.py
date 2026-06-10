from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0004_add_judge_result'),
    ]

    operations = [
        migrations.AlterField(
            model_name='workspace',
            name='name',
            field=models.CharField(max_length=100),
        ),
        migrations.AlterField(
            model_name='workspace',
            name='slug',
            field=models.SlugField(max_length=120, unique=True),
        ),
    ]
